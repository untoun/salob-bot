import { DateTime } from "luxon";
import type { NotificationType } from "@prisma/client";

export interface TextInput {
  serviceName: string;
  masterName: string;
  startsAt: Date;
  address?: string;
  now: Date;
  zone: string;
}

/** «Сегодня» / «Завтра» / «25 сентября» */
export function dayLabel(startsAt: Date, now: Date, zone: string): string {
  const s = DateTime.fromJSDate(startsAt, { zone }).startOf("day");
  const n = DateTime.fromJSDate(now, { zone }).startOf("day");
  const diff = Math.round(s.diff(n, "days").days);
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Завтра";
  return DateTime.fromJSDate(startsAt, { zone }).setLocale("ru").toLocaleString({ day: "numeric", month: "long" });
}

export function buildNotificationText(type: NotificationType, i: TextInput): string {
  const time = DateTime.fromJSDate(i.startsAt, { zone: i.zone }).toFormat("HH:mm");
  const when = `${dayLabel(i.startsAt, i.now, i.zone)} в ${time}`;
  const addr = i.address ? `\n\n📍 ${i.address}` : "";
  switch (type) {
    case "REMINDER_24H":
    case "REMINDER_2H":
      return `Напоминаем 😊\n\n${when} вы записаны: ${i.serviceName}, мастер ${i.masterName}.${addr}\n\nДо встречи!`;
    case "BOOKING_CANCELLED":
      return `Ваша запись (${i.serviceName}, ${when.toLowerCase()}) отменена.\n\nЕсли захотите записаться снова, я помогу выбрать время.`;
    case "BOOKING_RESCHEDULED":
      return `Ваша запись перенесена: ${when}, ${i.serviceName}, мастер ${i.masterName}.${addr}`;
    case "BOOKING_CONFIRMATION":
      return `Вы записаны: ${when}, ${i.serviceName}, мастер ${i.masterName}.${addr}`;
  }
}

/** Не отправляем напоминания, потерявшие смысл (cron долго не работал, запись скоро/уже прошла) */
export function isStale(type: NotificationType, scheduledAt: Date, startsAt: Date, now: Date): boolean {
  const late = now.getTime() - scheduledAt.getTime();
  const untilStart = startsAt.getTime() - now.getTime();
  const H = 3_600_000;
  switch (type) {
    case "REMINDER_24H":
      return untilStart < 3 * H || late > 6 * H; // за 3 часа до визита «за 24 часа» уже неуместно
    case "REMINDER_2H":
      return untilStart < 15 * 60_000 || late > 90 * 60_000;
    case "BOOKING_CANCELLED":
      return late > 2 * 24 * H;
    default:
      return late > 2 * 24 * H;
  }
}
