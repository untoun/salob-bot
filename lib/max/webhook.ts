import { prisma } from "@/lib/db/prisma";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Атомарно «занимает» событие. true — обрабатывать, false — дубликат.
 * Событие в статусе FAILED можно взять повторно (ровно одним конкурентом).
 */
export async function claimEvent(input: { eventId: string; eventType: string; payloadHash: string }): Promise<boolean> {
  try {
    await prisma.webhookEvent.create({ data: { ...input, status: "RECEIVED" } });
    return true;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const reclaimed = await prisma.webhookEvent.updateMany({
      where: { eventId: input.eventId, status: "FAILED" },
      data: { status: "RECEIVED", error: null },
    });
    return reclaimed.count === 1;
  }
}

export async function markEvent(eventId: string, status: "PROCESSED" | "FAILED", error?: string) {
  await prisma.webhookEvent.update({
    where: { eventId },
    data: { status, error: error?.slice(0, 500), processedAt: status === "PROCESSED" ? new Date() : undefined },
  });
}
