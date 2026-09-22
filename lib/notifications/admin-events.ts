import { DateTime } from "luxon";
import { cb } from "@/lib/bot/callbacks";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import type { Button } from "@/lib/max/types";
import { formatPrice } from "@/lib/utils/format";
import { notifyAdmins } from "./admin";

export type BookingEvent = "new" | "rescheduled" | "cancelled";

const TITLE: Record<BookingEvent, string> = { new: "🔔 Новая запись", rescheduled: "🔄 Запись перенесена", cancelled: "❌ Клиент отменил запись" };

/** Уведомление администраторам о событии с записью. Best-effort: сбой не влияет на запись клиента. */
export async function notifyAdminsBooking(kind: BookingEvent, bookingId: string): Promise<void> {
  try {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, master: true, service: true } });
    if (!b) return;
    const dt = DateTime.fromJSDate(b.startsAt, { zone: env().SALON_TIMEZONE });
    const text = [
      TITLE[kind],
      "",
      `Клиент: ${b.client.name}`,
      `Телефон: ${b.client.phone ?? "—"}`,
      `Услуга: ${b.service.name}`,
      `Мастер: ${b.master.name}`,
      `Дата: ${dt.toFormat("dd.MM")}`,
      `Время: ${dt.toFormat("HH:mm")}`,
      `Стоимость: ${formatPrice(b.priceRub, b.priceFrom)}`,
    ].join("\n");

    const buttons: Button[][] = [];
    if (kind !== "cancelled" && ["NEW", "CONFIRMED"].includes(b.status)) {
      const row: Button[] = [];
      if (b.status === "NEW") row.push({ type: "callback", text: "✅ Подтвердить", payload: cb.admConfirm(b.id), intent: "positive" });
      row.push({ type: "callback", text: "❌ Отменить запись", payload: cb.admCancelAsk(b.id), intent: "negative" });
      buttons.push(row);
    }
    await notifyAdmins(text, buttons);
  } catch (e) {
    logger.warn("admin booking notification failed", { operation: "notify_admin_booking", bookingId, error: errorMessage(e) });
  }
}
