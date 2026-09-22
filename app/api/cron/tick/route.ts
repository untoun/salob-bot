import { runGoogleSync } from "@/lib/google/sync";
import { errorMessage, logger } from "@/lib/logging/logger";
import { ensureReminderRows, processDueNotifications } from "@/lib/notifications/sender";
import { isCronAuthorized, unauthorized } from "@/lib/security/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Один вызов = напоминания/уведомления + синхронизация с Google Таблицей.
 * Нужен для планировщиков вне Vercel (тариф Hobby не позволяет cron чаще раза в сутки):
 * достаточно ОДНОЙ задачи «каждые 5 минут» на этот адрес с заголовком Authorization: Bearer <CRON_SECRET>.
 * Шаги независимы: сбой одного не мешает другому. При любой ошибке ответ 500 — внешний монитор это заметит.
 */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized();
  const started = Date.now();
  const result: { reminders?: unknown; sync?: unknown } = {};
  let failed = false;

  try {
    const created = await ensureReminderRows();
    const report = await processDueNotifications({ limit: 100 });
    result.reminders = { created, ...report };
  } catch (e) {
    failed = true;
    result.reminders = { error: true };
    logger.error("tick: reminders failed", { operation: "cron_tick", error: errorMessage(e) });
  }

  try {
    result.sync = await runGoogleSync();
  } catch (e) {
    failed = true;
    result.sync = { error: true };
    logger.error("tick: sync failed", { operation: "cron_tick", error: errorMessage(e) });
  }

  logger.info("cron tick", { operation: "cron_tick", duration: Date.now() - started, status: failed ? "partial_failure" : "ok" });
  return Response.json({ ok: !failed, ...result }, { status: failed ? 500 : 200 });
}
