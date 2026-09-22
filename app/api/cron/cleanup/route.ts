import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import { isCronAuthorized, unauthorized } from "@/lib/security/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized();
  const now = Date.now();
  try {
    const [sessions, staleEvents, events, queue, limits] = await Promise.all([
      prisma.botSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      // необработанные события старше 10 минут помечаем как FAILED: при повторной доставке их можно взять заново
      prisma.webhookEvent.updateMany({ where: { status: "RECEIVED", receivedAt: { lt: new Date(now - 10 * 60_000) } }, data: { status: "FAILED", error: "stale" } }),
      prisma.webhookEvent.deleteMany({ where: { status: "PROCESSED", receivedAt: { lt: new Date(now - 14 * DAY) } } }),
      prisma.syncQueue.deleteMany({ where: { status: "DONE", processedAt: { lt: new Date(now - 7 * DAY) } } }),
      prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now - 60 * 60_000) } } }),
    ]);
    const result = { sessions: sessions.count, staleEvents: staleEvents.count, events: events.count, queue: queue.count, rateLimits: limits.count };
    logger.info("cron cleanup", { operation: "cron_cleanup", ...result });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    logger.error("cron cleanup failed", { operation: "cron_cleanup", error: errorMessage(e) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
