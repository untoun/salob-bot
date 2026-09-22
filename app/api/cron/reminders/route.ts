import { errorMessage, logger } from "@/lib/logging/logger";
import { ensureReminderRows, processDueNotifications } from "@/lib/notifications/sender";
import { isCronAuthorized, unauthorized } from "@/lib/security/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized();
  const started = Date.now();
  try {
    const created = await ensureReminderRows();
    const report = await processDueNotifications({ limit: 100 });
    logger.info("cron reminders", { operation: "cron_reminders", duration: Date.now() - started, created, ...report });
    return Response.json({ ok: true, created, ...report });
  } catch (e) {
    logger.error("cron reminders failed", { operation: "cron_reminders", error: errorMessage(e) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
