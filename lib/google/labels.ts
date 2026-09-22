import type { BookingStatus } from "@prisma/client";

export const STATUS_RU: Record<BookingStatus, string> = {
  NEW: "Новая",
  CONFIRMED: "Подтверждена",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
  RESCHEDULED: "Перенесена",
  NO_SHOW: "Не пришёл",
};

const REVERSE = new Map(Object.entries(STATUS_RU).map(([k, v]) => [v.toLowerCase(), k as BookingStatus]));

export function statusFromRu(label: string): BookingStatus | null {
  return REVERSE.get(label.trim().toLowerCase()) ?? null;
}

export const yesNo = (v: boolean) => (v ? "Да" : "Нет");

export function parseYesNo(s: string): boolean | null {
  const v = s.trim().toLowerCase();
  if (["да", "yes", "true", "1"].includes(v)) return true;
  if (["нет", "no", "false", "0"].includes(v)) return false;
  return null;
}

export function parseIntStrict(s: string): number | null {
  const cleaned = s.replace(/[\s\u00a0\u202f₽]/g, "");
  return /^\d{1,9}$/.test(cleaned) ? Number(cleaned) : null;
}

export const WEEKDAY_RU = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
