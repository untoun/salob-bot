import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { dayStartUtc, nowLocal, weekdayOf } from "@/lib/utils/time";
import { computeSlotMinutes, resolveDayWindow } from "./slots";

export type Db = PrismaClient | Prisma.TransactionClient;

export const LIVE_STATUSES = ["NEW", "CONFIRMED"] as const;
/** Не даём записаться «на прямо сейчас» */
export const MIN_LEAD_MINUTES = 60;
export const SLOT_STEP_MINUTES = 30;

/** Свободные начала слотов (минуты от полуночи) мастера на локальную дату */
export async function getDaySlotMinutes(
  db: Db,
  masterId: string,
  dateISO: string,
  durationMin: number,
  excludeBookingId?: string,
): Promise<number[]> {
  const [weekly, exceptions] = await Promise.all([
    db.schedule.findUnique({ where: { masterId_weekday: { masterId, weekday: weekdayOf(dateISO) } } }),
    db.scheduleException.findMany({ where: { masterId, date: new Date(`${dateISO}T00:00:00.000Z`) } }),
  ]);
  const window = resolveDayWindow(weekly, exceptions);
  if (!window) return [];

  const dayStart = dayStartUtc(dateISO);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const bookings = await db.booking.findMany({
    where: {
      masterId,
      status: { in: [...LIVE_STATUSES] },
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });

  const toMin = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / 60_000);
  const busy = [...window.breaks, ...bookings.map((b) => ({ startMin: toMin(b.startsAt), endMin: toMin(b.endsAt) }))];
  const earliestMin = Math.ceil((Date.now() + MIN_LEAD_MINUTES * 60_000 - dayStart.getTime()) / 60_000);

  return computeSlotMinutes({ startMin: window.startMin, endMin: window.endMin, busy, durationMin, stepMin: SLOT_STEP_MINUTES, earliestMin });
}

/** Даты (YYYY-MM-DD), на которые у любого из мастеров есть свободное время */
export async function getAvailableDates(
  masterIds: string[],
  durationMin: number,
  opts: { days?: number; excludeBookingId?: string } = {},
): Promise<string[]> {
  if (!masterIds.length) return [];
  const rows = await prisma.schedule.findMany({ where: { masterId: { in: masterIds } }, select: { masterId: true, weekday: true } });
  const worksOn = new Map<string, Set<number>>();
  for (const r of rows) worksOn.set(r.masterId, (worksOn.get(r.masterId) ?? new Set()).add(r.weekday));

  const today = nowLocal().startOf("day");
  const checks: Promise<string | null>[] = [];
  for (let i = 0; i < (opts.days ?? 14); i++) {
    const d = today.plus({ days: i });
    const iso = d.toISODate();
    if (!iso) continue;
    for (const m of masterIds) {
      if (!worksOn.get(m)?.has(d.weekday)) continue;
      checks.push(getDaySlotMinutes(prisma, m, iso, durationMin, opts.excludeBookingId).then((s) => (s.length ? iso : null)));
    }
  }
  const found = (await Promise.all(checks)).filter((x): x is string => x !== null);
  return [...new Set(found)].sort();
}

/** Объединённые слоты нескольких мастеров (для «Любой мастер») */
export async function getSlotsForMasters(masterIds: string[], dateISO: string, durationMin: number, excludeBookingId?: string): Promise<number[]> {
  const lists = await Promise.all(masterIds.map((m) => getDaySlotMinutes(prisma, m, dateISO, durationMin, excludeBookingId)));
  return [...new Set(lists.flat())].sort((a, b) => a - b);
}
