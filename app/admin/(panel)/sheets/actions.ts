"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, done } from "@/lib/admin/forms";
import { runGoogleSync } from "@/lib/google/sync";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";

const BACK = "/admin/sheets";

export async function syncNow(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("sheets", fd);
  let msg = "synced";
  try {
    const r = await runGoogleSync();
    if (r.skipped === "not_configured") msg = "notconfigured";
    else if (r.skipped === "locked") msg = "busy";
    else if (r.failed > 0) msg = "failed";
  } catch (e) {
    logger.error("manual sync failed", { operation: "admin_sync", error: errorMessage(e) });
    msg = "failed";
  }
  await audit(admin.id, "sheets.sync_now", "Sync");
  revalidatePath(BACK);
  done(BACK, msg);
}

export async function retryFailed(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("sheets", fd);
  const r = await prisma.syncQueue.updateMany({ where: { status: "FAILED" }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), error: null } });
  await prisma.booking.updateMany({ where: { syncStatus: "SYNC_ERROR" }, data: { syncStatus: "SYNC_PENDING" } });
  await audit(admin.id, "sheets.retry_failed", "Sync", undefined, { count: r.count });
  revalidatePath(BACK);
  done(BACK, "retried");
}
