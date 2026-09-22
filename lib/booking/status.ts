import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { canTransition } from "./status-rules";

export type StatusResult = "applied" | "rejected" | "noop" | "unknown";

/**
 * Единая точка ручной смены статуса (используется админкой и обратной синхронизацией из Sheets).
 * origin = "SHEETS": изменение уже видно в таблице, повторную запись в неё не ставим в очередь
 * (это и разрывает цикл DB → Sheets → DB).
 */
export async function applyBookingStatus(bookingId: string, next: BookingStatus, origin: "DB" | "SHEETS", actorAdminId?: string): Promise<StatusResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return "unknown";
  if (booking.status === next) return "noop";
  if (!canTransition(booking.status, next)) return "rejected";

  return prisma.$transaction(async (tx) => {
    const r = await tx.booking.updateMany({
      where: { id: bookingId, status: booking.status }, // оптимистичная проверка
      data: {
        status: next,
        slotKey: null, // все допустимые переходы, кроме NEW→CONFIRMED, освобождают слот
        idempotencyKey: null,
        lastSyncSource: origin,
        lastSyncedAt: origin === "SHEETS" ? new Date() : undefined,
        syncStatus: origin === "SHEETS" ? "SYNCED" : "SYNC_PENDING",
      },
    });
    if (r.count === 0) return "noop" as const;

    if (next === "CONFIRMED") {
      // NEW → CONFIRMED: слот остаётся занятым
      await tx.booking.update({ where: { id: bookingId }, data: { slotKey: `${booking.masterId}|${booking.startsAt.toISOString()}` } });
    } else {
      await tx.notification.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "SKIPPED" } });
    }
    if (next === "CANCELLED") {
      await tx.client.update({ where: { id: booking.clientId }, data: { cancelsCount: { increment: 1 } } });
      // клиенту уйдёт сообщение об отмене (отправляет cron уведомлений)
      const user = await tx.client.findUnique({ where: { id: booking.clientId }, select: { userId: true } });
      await tx.notification.createMany({
        data: [{ bookingId, userId: user?.userId, type: "BOOKING_CANCELLED", scheduledAt: new Date() }],
        skipDuplicates: true,
      });
    }
    if (next === "COMPLETED") {
      await tx.client.update({ where: { id: booking.clientId }, data: { visitsCount: { increment: 1 }, lastVisitAt: booking.startsAt } });
    }
    if (origin === "DB") await tx.syncQueue.create({ data: { entityType: "booking", entityId: bookingId, action: "STATUS_CHANGE" } });
    await tx.syncQueue.create({ data: { entityType: "client", entityId: booking.clientId, action: "UPSERT" } });
    await tx.auditLog.create({ data: { adminId: actorAdminId, action: "booking.status", entityType: "Booking", entityId: bookingId, meta: { from: booking.status, to: next, origin } } });
    return "applied" as const;
  });
}
