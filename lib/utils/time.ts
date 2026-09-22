import { DateTime } from "luxon";
import { env } from "@/lib/config/env";

const zone = () => env().SALON_TIMEZONE;

export const nowLocal = () => DateTime.now().setZone(zone());

export function isValidDateISO(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && DateTime.fromISO(s, { zone: zone() }).isValid;
}

/** Начало локальных суток в UTC */
export function dayStartUtc(dateISO: string): Date {
  return DateTime.fromISO(dateISO, { zone: zone() }).startOf("day").toUTC().toJSDate();
}

/** Локальная дата салона + минуты от полуночи -> UTC */
export function toUtc(dateISO: string, minutes: number): Date {
  return DateTime.fromISO(dateISO, { zone: zone() }).startOf("day").plus({ minutes }).toUTC().toJSDate();
}

/** 1 = Пн … 7 = Вс */
export function weekdayOf(dateISO: string): number {
  return DateTime.fromISO(dateISO, { zone: zone() }).weekday;
}

export function minutesToHHmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const ru = (d: DateTime) => d.setLocale("ru");

export function formatDateRu(d: Date | string): string {
  const dt = typeof d === "string" ? DateTime.fromISO(d, { zone: zone() }) : DateTime.fromJSDate(d, { zone: zone() });
  return ru(dt).toLocaleString({ day: "numeric", month: "long" });
}

export function formatTimeLocal(d: Date): string {
  return DateTime.fromJSDate(d, { zone: zone() }).toFormat("HH:mm");
}

export function dateButtonLabel(dateISO: string): string {
  return ru(DateTime.fromISO(dateISO, { zone: zone() })).toLocaleString({ weekday: "short", day: "numeric", month: "short" });
}
