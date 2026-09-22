import type { BookingStatus, Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { isValidDateISO, nowLocal } from "@/lib/utils/time";

export const PAGE_SIZE = 50;
const STATUSES: BookingStatus[] = ["NEW", "CONFIRMED", "COMPLETED", "CANCELLED", "RESCHEDULED", "NO_SHOW"];
const ID = /^[A-Za-z0-9_-]{8,40}$/;

export interface BookingFilters {
  from: string;
  to: string;
  status?: BookingStatus;
  masterId?: string;
  q?: string;
  page: number;
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Все параметры из URL считаются недоверенными: приводим к безопасным значениям или отбрасываем */
export function parseFilters(sp: SP): BookingFilters {
  const today = nowLocal().startOf("day");
  const from = one(sp.from);
  const to = one(sp.to);
  const status = one(sp.status);
  const master = one(sp.master);
  const q = one(sp.q)?.trim().slice(0, 60);
  const page = Number(one(sp.page));
  return {
    from: from && isValidDateISO(from) ? from : today.toISODate()!,
    to: to && isValidDateISO(to) ? to : today.plus({ days: 7 }).toISODate()!,
    status: STATUSES.find((s) => s === status),
    masterId: master && ID.test(master) ? master : undefined,
    q: q || undefined,
    page: Number.isInteger(page) && page > 0 && page < 10_000 ? page : 1,
  };
}

export function buildWhere(f: BookingFilters, scope: { masterId?: string }): Prisma.BookingWhereInput {
  const zone = env().SALON_TIMEZONE;
  const start = DateTime.fromISO(f.from, { zone }).startOf("day");
  const end = DateTime.fromISO(f.to, { zone }).startOf("day").plus({ days: 1 });
  const digits = f.q?.replace(/\D/g, "");
  return {
    ...scope, // ограничение по роли применяется ВСЕГДА и перекрывает фильтр по мастеру из URL
    ...(!scope.masterId && f.masterId ? { masterId: f.masterId } : {}),
    startsAt: { gte: start.toUTC().toJSDate(), lt: end.toUTC().toJSDate() },
    ...(f.status ? { status: f.status } : {}),
    ...(f.q
      ? {
          client: {
            OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : [])],
          },
        }
      : {}),
  };
}

export function safeBackPath(v: FormDataEntryValue | null): string {
  return typeof v === "string" && /^\/admin\/bookings(\/[A-Za-z0-9_-]{8,40})?(\?[\w=&%.\-+]*)?$/.test(v) ? v : "/admin/bookings";
}
