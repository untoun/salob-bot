import type { Notification, NotificationType } from "@prisma/client";
import { LIVE_STATUSES } from "@/lib/booking/availability";
import { cb } from "@/lib/bot/callbacks";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import { MaxApiError, sendMessage } from "@/lib/max/client";
import type { Button } from "@/lib/max/types";
import { buildNotificationText, isStale } from "./templates";

const SENDABLE: NotificationType[] = ["REMINDER_24H", "REMINDER_2H", "BOOKING_CANCELLED", "BOOKING_CONFIRMATION", "BOOKING_RESCHEDULED"];
const MAX_ATTEMPTS = 3;
const CONCURRENCY = 5;

export interface SendReport {
  sent: number;
  skipped: number;
  failed: number;
  retry: number;
  lost: number;
}

/** Создаёт недостающие строки напоминаний (например, для записей, созданных администратором) */
export async function ensureReminderRows(now = new Date()): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: [...LIVE_STATUSES] },
      startsAt: { gt: now, lt: new Date(now.getTime() + 26 * 3_600_000) },
      client: { userId: { not: null } },
    },
    select: { id: true, startsAt: true, client: { select: { userId: true } }, notifications: { select: { type: true } } },
    take: 500,
  });
  const rows = [];
  for (const b of bookings) {
    const have = new Set(b.notifications.map((n) => n.type));
    for (const [type, hours] of [["REMINDER_24H", 24], ["REMINDER_2H", 2]] as const) {
      if (have.has(type)) continue;
      const at = new Date(b.startsAt.getTime() - hours * 3_600_000);
      // только «только что наступившие»: далёкое прошлое смысла не имеет
      if (at.getTime() >= now.getTime() - 10 * 60_000) rows.push({ bookingId: b.id, userId: b.client.userId, type, scheduledAt: at });
    }
  }
  if (!rows.length) return 0;
  const r = await prisma.notification.createMany({ data: rows, skipDuplicates: true });
  return r.count;
}

type Loaded = Notification & {
  booking: { id: string; status: string; startsAt: Date; service: { name: string }; master: { name: string } };
  user: { maxUserId: bigint; blockedBot: boolean } | null;
};

async function finish(id: string, status: "SENT" | "SKIPPED" | "FAILED", error?: string) {
  await prisma.notification.update({ where: { id }, data: { status, error: error?.slice(0, 300), sentAt: status === "SENT" ? new Date() : undefined } });
}

async function processOne(n: Loaded, now: Date): Promise<keyof SendReport> {
  // Атомарный «захват»: параллельный запуск cron не отправит то же уведомление второй раз
  const claim = await prisma.notification.updateMany({ where: { id: n.id, status: "PENDING", attempts: n.attempts }, data: { attempts: { increment: 1 } } });
  if (claim.count !== 1) return "lost";

  const b = n.booking;
  const relevant = n.type === "BOOKING_CANCELLED" ? b.status === "CANCELLED" : (LIVE_STATUSES as readonly string[]).includes(b.status);
  if (!relevant) {
    await finish(n.id, "SKIPPED", "booking status changed");
    return "skipped";
  }
  if (isStale(n.type, n.scheduledAt, b.startsAt, now)) {
    await finish(n.id, "SKIPPED", "stale");
    return "skipped";
  }
  if (!n.user || n.user.blockedBot) {
    await finish(n.id, "SKIPPED", "no recipient");
    return "skipped";
  }

  const e = env();
  const text = buildNotificationText(n.type, {
    serviceName: b.service.name,
    masterName: b.master.name,
    startsAt: b.startsAt,
    address: e.SALON_ADDRESS || undefined,
    now,
    zone: e.SALON_TIMEZONE,
  });
  const buttons: Button[][] =
    n.type === "BOOKING_CANCELLED"
      ? [[{ type: "callback", text: "💇 Записаться", payload: cb.bkStart }]]
      : [[{ type: "callback", text: "📅 Моя запись", payload: cb.myItem(b.id) }]];

  try {
    await sendMessage({ userId: Number(n.user.maxUserId) }, { text, buttons });
    await finish(n.id, "SENT");
    return "sent";
  } catch (err) {
    const status = err instanceof MaxApiError ? err.status : 0;
    const permanent = status >= 400 && status < 500 && status !== 429;
    if (permanent || n.attempts + 1 >= MAX_ATTEMPTS) {
      await finish(n.id, "FAILED", errorMessage(err));
      logger.error("notification failed", { operation: "send_notification", bookingId: b.id, status: String(status), error: errorMessage(err) });
      return "failed";
    }
    await prisma.notification.update({ where: { id: n.id }, data: { error: errorMessage(err).slice(0, 300) } });
    return "retry"; // останется PENDING, следующий запуск cron повторит
  }
}

export async function processDueNotifications(opts: { limit?: number; bookingId?: string } = {}): Promise<SendReport> {
  const now = new Date();
  const list = (await prisma.notification.findMany({
    where: { status: "PENDING", scheduledAt: { lte: now }, type: { in: SENDABLE }, ...(opts.bookingId ? { bookingId: opts.bookingId } : {}) },
    orderBy: { scheduledAt: "asc" },
    take: opts.limit ?? 100,
    include: { booking: { select: { id: true, status: true, startsAt: true, service: { select: { name: true } }, master: { select: { name: true } } } }, user: { select: { maxUserId: true, blockedBot: true } } },
  })) as Loaded[];

  const report: SendReport = { sent: 0, skipped: 0, failed: 0, retry: 0, lost: 0 };
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const results = await Promise.all(
      list.slice(i, i + CONCURRENCY).map((n) =>
        processOne(n, now).catch((e) => {
          logger.error("notification processing error", { operation: "send_notification", error: errorMessage(e) });
          return "retry" as const;
        }),
      ),
    );
    for (const r of results) report[r]++;
  }
  return report;
}
