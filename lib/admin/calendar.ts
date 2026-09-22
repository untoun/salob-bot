import { DateTime } from "luxon";
import { LIVE_STATUSES } from "@/lib/booking/availability";
import { resolveDayWindow } from "@/lib/booking/slots";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { dayStartUtc, isValidDateISO, nowLocal } from "@/lib/utils/time";

export { columnCells, type Cell, type CellState, type DayBooking } from "./calendar-cells";
import type { DayBooking } from "./calendar-cells";

export function parseDate(v: string | undefined): string {
  return v && isValidDateISO(v) ? v : nowLocal().toISODate()!;
}

const ACTIVE = [...LIVE_STATUSES, "COMPLETED", "NO_SHOW"] as const;

export async function loadDay(dateISO: string, masterIds?: string[]) {
  const zone = env().SALON_TIMEZONE;
  const start = dayStartUtc(dateISO);
  const end = new Date(start.getTime() + 86_400_000);
  const day = DateTime.fromISO(dateISO, { zone });
  const masters = await prisma.master.findMany({
    where: { active: true, ...(masterIds ? { id: { in: masterIds } } : {}) },
    include: { schedules: true },
    orderBy: { name: "asc" },
  });
  const [exceptions, bookings] = await Promise.all([
    prisma.scheduleException.findMany({ where: { date: new Date(`${dateISO}T00:00:00.000Z`), masterId: { in: masters.map((m) => m.id) } } }),
    prisma.booking.findMany({
      where: { masterId: { in: masters.map((m) => m.id) }, status: { in: [...ACTIVE] }, startsAt: { gte: start, lt: end } },
      include: { client: { select: { name: true } }, service: { select: { name: true } } },
    }),
  ]);
  return masters.map((m) => {
    const window = resolveDayWindow(m.schedules.find((s) => s.weekday === day.weekday) ?? null, exceptions.filter((e) => e.masterId === m.id));
    const list: DayBooking[] = bookings
      .filter((b) => b.masterId === m.id)
      .map((b) => {
        const s = DateTime.fromJSDate(b.startsAt, { zone });
        const startMin = s.hour * 60 + s.minute;
        return { id: b.id, startMin, endMin: startMin + b.durationMin, label: b.service.name, client: b.client.name, status: b.status };
      });
    return { master: { id: m.id, name: m.name }, window, bookings: list };
  });
}

/** Количество записей по датам диапазона (для месячного вида) и признак «выходной» не считаем — только нагрузка */
export async function loadCounts(fromISO: string, toISO: string, masterId?: string): Promise<Map<string, number>> {
  const zone = env().SALON_TIMEZONE;
  const start = dayStartUtc(fromISO);
  const end = DateTime.fromISO(toISO, { zone }).startOf("day").plus({ days: 1 }).toUTC().toJSDate();
  const rows = await prisma.booking.findMany({
    where: { ...(masterId ? { masterId } : {}), status: { in: [...LIVE_STATUSES, "COMPLETED"] }, startsAt: { gte: start, lt: end } },
    select: { startsAt: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = DateTime.fromJSDate(r.startsAt, { zone }).toISODate()!;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

export async function loadWeek(mondayISO: string, masterId: string) {
  const zone = env().SALON_TIMEZONE;
  const days = Array.from({ length: 7 }, (_, i) => DateTime.fromISO(mondayISO, { zone }).plus({ days: i }).toISODate()!);
  return Promise.all(days.map(async (iso) => ({ iso, col: (await loadDay(iso, [masterId]))[0] })));
}
