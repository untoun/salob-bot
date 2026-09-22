import { errorMessage, logger } from "@/lib/logging/logger";
import { runGoogleSync } from "@/lib/google/sync";
import { isCronAuthorized, unauthorized } from "@/lib/security/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return unauthorized();
  const started = Date.now();
  try {
    const report = await runGoogleSync();
    logger.info("cron sync-google", { operation: "cron_sync_google", duration: Date.now() - started, ...report });
    return Response.json({ ok: true, ...report });
  } catch (e) {
    logger.error("cron sync-google failed", { operation: "cron_sync_google", error: errorMessage(e) });
    return Response.json({ ok: false }, { status: 500 });
  }
}
