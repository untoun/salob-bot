import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { LIVE_STATUSES } from "@/lib/booking/availability";
import { resolveDayWindow, type Interval } from "@/lib/booking/slots";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { nowLocal } from "@/lib/utils/time";

export interface TimelineMaster {
  id: string;
  name: string;
  window: { startMin: number; endMin: number; breaks: Interval[] } | null;
  bookings: { id: string; startMin: number; endMin: number; label: string; status: string; client: string }[];
}

export interface DashboardData {
  todayCount: number;
  tomorrowCount: number;
  revenueToday: number;
  expectedToday: number;
  revenueWeek: number;
  completedWeek: number;
  cancelsWeek: number;
  newClientsWeek: number | null; // null: мастеру не показываем
  perDay: { iso: string; label: string; count: number; revenue: number; isToday: boolean }[];
  topServices: { name: string; count: number }[];
  load: { name: string; percent: number; bookedMin: number; workMin: number }[];
  timeline: TimelineMaster[];
}

const ACTIVE_OR_DONE = [...LIVE_STATUSES, "COMPLETED", "NO_SHOW"] as const;

/** scope — ограничение по роли (мастер видит только свои записи) */
export async function loadDashboard(scope: { masterId?: string }, opts: { showClients: boolean }): Promise<DashboardData> {
  const zone = env().SALON_TIMEZONE;
  const today = nowLocal().startOf("day");
  const utc = (d: DateTime) => d.toUTC().toJSDate();
  const dayRange = (from: DateTime, to: DateTime) => ({ gte: utc(from), lt: utc(to) });
  const where = (extra: Prisma.BookingWhereInput): Prisma.BookingWhereInput => ({ ...scope, ...extra });
  const localOf = (d: Date) => DateTime.fromJSDate(d, { zone });
  const weekFrom = today.minus({ days: 6 });
  const tomorrow = today.plus({ days: 1 });

  const [todayBookings, tomorrowCount, revenueToday, revenueWeek, completedWeek, cancelsWeek, newClients, range, top, masters, exceptions] = await Promise.all([
    prisma.booking.findMany({
      where: where({ status: { in: [...ACTIVE_OR_DONE] }, startsAt: dayRange(today, tomorrow) }),
      include: { client: { select: { name: true } }, service: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.booking.count({ where: where({ status: { in: [...LIVE_STATUSES] }, startsAt: dayRange(tomorrow, today.plus({ days: 2 })) }) }),
    prisma.booking.aggregate({ _sum: { priceRub: true }, where: where({ status: "COMPLETED", startsAt: dayRange(today, tomorrow) }) }),
    prisma.booking.aggregate({ _sum: { priceRub: true }, where: where({ status: "COMPLETED", startsAt: dayRange(weekFrom, tomorrow) }) }),
    prisma.booking.count({ where: where({ status: "COMPLETED", startsAt: dayRange(weekFrom, tomorrow) }) }),
    prisma.booking.count({ where: where({ status: "CANCELLED", updatedAt: { gte: utc(weekFrom) } }) }),
    opts.showClients ? prisma.client.count({ where: { createdAt: { gte: utc(weekFrom) }, anonymizedAt: null } }) : Promise.resolve(null),
    prisma.booking.findMany({
      where: where({ status: { in: [...ACTIVE_OR_DONE] }, startsAt: dayRange(today.minus({ days: 7 }), today.plus({ days: 7 })) }),
      select: { startsAt: true, priceRub: true, status: true, masterId: true, durationMin: true },
    }),
    prisma.booking.groupBy({
      by: ["serviceId"],
      where: where({ status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: utc(today.minus({ days: 30 })) } }),
      _count: { _all: true },
      orderBy: { _count: { serviceId: "desc" } },
      take: 5,
    }),
    prisma.master.findMany({ where: { active: true, ...(scope.masterId ? { id: scope.masterId } : {}) }, include: { schedules: true }, orderBy: { name: "asc" } }),
    prisma.scheduleException.findMany({
      where: { date: { gte: new Date(`${today.toISODate()}T00:00:00Z`), lt: new Date(`${today.plus({ days: 7 }).toISODate()}T00:00:00Z`) } },
    }),
  ]);

  const serviceNames = await prisma.service.findMany({ where: { id: { in: top.map((t) => t.serviceId) } }, select: { id: true, name: true } });
  const nameOf = new Map(serviceNames.map((s) => [s.id, s.name]));

  // Записи по дням: 7 назад … 6 вперёд (по местной дате салона)
  const days = new Map<string, { count: number; revenue: number }>();
  for (let i = -7; i < 7; i++) days.set(today.plus({ days: i }).toISODate()!, { count: 0, revenue: 0 });
  for (const b of range) {
    const d = days.get(localOf(b.startsAt).toISODate()!);
    if (!d) continue;
    d.count++;
    if (b.status === "COMPLETED") d.revenue += b.priceRub;
  }
  const perDay = [...days.entries()].map(([iso, v]) => ({
    iso,
    label: DateTime.fromISO(iso, { zone }).setLocale("ru").toFormat("dd.MM"),
    count: v.count,
    revenue: v.revenue,
    isToday: iso === today.toISODate(),
  }));

  // Загрузка мастеров на ближайшие 7 дней: занятые минуты / рабочие минуты
  const load = masters.map((m) => {
    let workMin = 0;
    for (let i = 0; i < 7; i++) {
      const d = today.plus({ days: i });
      const ex = exceptions.filter((e) => e.masterId === m.id && e.date.toISOString().slice(0, 10) === d.toISODate());
      const w = resolveDayWindow(m.schedules.find((s) => s.weekday === d.weekday) ?? null, ex);
      if (w) workMin += w.endMin - w.startMin - w.breaks.reduce((a, b) => a + (b.endMin - b.startMin), 0);
    }
    const bookedMin = range
      .filter((b) => b.masterId === m.id && (LIVE_STATUSES as readonly string[]).includes(b.status) && b.startsAt >= today.toJSDate() && b.startsAt < utc(today.plus({ days: 7 })))
      .reduce((a, b) => a + b.durationMin, 0);
    return { name: m.name, bookedMin, workMin, percent: workMin ? Math.min(100, Math.round((bookedMin / workMin) * 100)) : 0 };
  });

  // Лента дня
  const timeline: TimelineMaster[] = masters.map((m) => {
    const ex = exceptions.filter((e) => e.masterId === m.id && e.date.toISOString().slice(0, 10) === today.toISODate());
    return {
      id: m.id,
      name: m.name,
      window: resolveDayWindow(m.schedules.find((s) => s.weekday === today.weekday) ?? null, ex),
      bookings: todayBookings
        .filter((b) => b.masterId === m.id)
        .map((b) => {
          const s = localOf(b.startsAt);
          const startMin = s.hour * 60 + s.minute;
          return {
            id: b.id,
            startMin,
            endMin: startMin + b.durationMin,
            label: b.service.name,
            status: b.status,
            client: b.client.name,
          };
        }),
    };
  });

  return {
    todayCount: todayBookings.filter((b) => (LIVE_STATUSES as readonly string[]).includes(b.status) || b.status === "COMPLETED").length,
    tomorrowCount,
    revenueToday: revenueToday._sum.priceRub ?? 0,
    expectedToday: todayBookings.filter((b) => (LIVE_STATUSES as readonly string[]).includes(b.status)).reduce((a, b) => a + b.priceRub, 0),
    revenueWeek: revenueWeek._sum.priceRub ?? 0,
    completedWeek,
    cancelsWeek,
    newClientsWeek: newClients,
    perDay,
    topServices: top.map((t) => ({ name: nameOf.get(t.serviceId) ?? "—", count: t._count._all })),
    load,
    timeline,
  };
}
