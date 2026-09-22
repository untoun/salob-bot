import { prisma } from "@/lib/db/prisma";
import { LIVE_STATUSES } from "@/lib/booking/availability";

export type AnonymizeResult = "done" | "has_future" | "not_found" | "already";

/**
 * Удаление персональных данных по запросу клиента (право на удаление).
 * История записей остаётся для учёта, но обезличивается. Если есть будущие записи — сначала их нужно отменить.
 * Строки клиента и его записей в Google Таблице перезаписываются очередью синхронизации.
 */
export async function anonymizeClient(clientId: string, adminId: string): Promise<AnonymizeResult> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, include: { bookings: { select: { id: true } } } });
  if (!client) return "not_found";
  if (client.anonymizedAt) return "already";
  const future = await prisma.booking.count({ where: { clientId, status: { in: [...LIVE_STATUSES] }, startsAt: { gte: new Date() } } });
  if (future > 0) return "has_future";

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: { name: "[удалён]", phone: null, comment: null, anonymizedAt: new Date(), userId: null },
    });
    await tx.booking.updateMany({ where: { clientId }, data: { comment: null, syncStatus: "SYNC_PENDING" } });
    if (client.userId) {
      // MAX-профиль, диалоговые сессии и уведомления клиента удаляются
      await tx.user.delete({ where: { id: client.userId } });
    }
    await tx.syncQueue.createMany({
      data: [
        { entityType: "client", entityId: clientId, action: "UPSERT" as const },
        ...client.bookings.map((b) => ({ entityType: "booking", entityId: b.id, action: "UPSERT" as const })),
      ],
    });
    await tx.auditLog.create({ data: { adminId, action: "client.anonymize", entityType: "Client", entityId: clientId } });
  });
  return "done";
}
