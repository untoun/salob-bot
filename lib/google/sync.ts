import type { SyncQueue } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting } from "@/lib/db/settings";
import { errorMessage, logger } from "@/lib/logging/logger";
import { notifyAdminsThrottled } from "@/lib/notifications/admin";
import { acquireLease, releaseLease } from "@/lib/sync/lease";
import { createSheetsIO, isGoogleConfigured } from "./client";
import { syncEntity, type SheetDef, type SheetsIO } from "./engine";
import { STATUS_RU } from "./labels";
import { refreshSnapshots, SNAPSHOT_DEFS } from "./snapshots";
import { bookingsSpec, ENTITY_SPECS } from "./specs";

const LEASE = "google-sync";
const MAX_ATTEMPTS = 8;
const RECONCILE_EVERY_MS = 30 * 60_000;
const BATCH = 300;

export interface SyncReport {
  skipped?: "not_configured" | "locked";
  processed: number;
  failed: number;
  pulled: number;
  rejected: number;
  reconciled: boolean;
}

const DEFS: SheetDef[] = [
  ...ENTITY_SPECS.map((s) => ({
    name: s.sheet,
    headers: s.headers,
    hashColumn: true,
    statusColumn: s === bookingsSpec ? { index: 11, options: Object.values(STATUS_RU) } : undefined,
  })),
  ...SNAPSHOT_DEFS,
];

const backoffMs = (attempts: number) => Math.min(2 ** attempts, 60) * 60_000;

async function failItems(items: SyncQueue[], entityType: string, error: string) {
  const terminal: SyncQueue[] = [];
  for (const it of items) {
    const give = it.attempts >= MAX_ATTEMPTS;
    if (give) terminal.push(it);
    await prisma.syncQueue.update({
      where: { id: it.id },
      data: { status: give ? "FAILED" : "PENDING", error: error.slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(it.attempts)) },
    });
  }
  if (entityType === "booking") {
    await prisma.booking.updateMany({
      where: { id: { in: items.map((i) => i.entityId) } },
      data: { syncStatus: "SYNC_PENDING" },
    });
    if (terminal.length) {
      await prisma.booking.updateMany({ where: { id: { in: terminal.map((i) => i.entityId) } }, data: { syncStatus: "SYNC_ERROR" } });
    }
  }
}

export async function runGoogleSync(): Promise<SyncReport> {
  const report: SyncReport = { processed: 0, failed: 0, pulled: 0, rejected: 0, reconciled: false };
  if (!isGoogleConfigured()) return { ...report, skipped: "not_configured" };
  if (!(await acquireLease(LEASE, 4 * 60_000))) return { ...report, skipped: "locked" };

  try {
    const now = new Date();
    // зависшие с прошлого запуска
    await prisma.syncQueue.updateMany({
      where: { status: "PROCESSING", lastAttemptAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
      data: { status: "PENDING" },
    });

    const due = await prisma.syncQueue.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: BATCH });
    if (due.length) {
      await prisma.syncQueue.updateMany({
        where: { id: { in: due.map((d) => d.id) }, status: "PENDING" },
        data: { status: "PROCESSING", lastAttemptAt: now, attempts: { increment: 1 } },
      });
    }
    const claimed = due.map((d) => ({ ...d, attempts: d.attempts + 1 }));

    const last = await getSetting<{ at: string }>("google_reconcile_at");
    const reconcile = !last || now.getTime() - new Date(last.at).getTime() > RECONCILE_EVERY_MS;
    report.reconciled = reconcile;

    let io: SheetsIO;
    try {
      io = createSheetsIO();
      await io.ensure(DEFS);
    } catch (e) {
      await failAll(claimed, e, report);
      return report;
    }

    for (const spec of ENTITY_SPECS) {
      const items = claimed.filter((c) => c.entityType === spec.entityType);
      try {
        const r = await syncEntity(io, spec, { queuedIds: new Set(items.map((i) => i.entityId)), reconcile });
        report.pulled += r.pulled;
        report.rejected += r.rejected;
        if (items.length) {
          await prisma.syncQueue.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status: "DONE", processedAt: new Date(), error: null } });
        }
        report.processed += items.length;
        await markSynced(spec.entityType, r.writtenIds);
      } catch (e) {
        logger.error("sheet sync failed", { operation: "sync_google", entity: spec.entityType, error: errorMessage(e) });
        report.failed += items.length;
        await failItems(items, spec.entityType, errorMessage(e));
        await notifyAdminsThrottled("google_sync", "⚠️ Не удаётся синхронизировать записи с Google Таблицей. Записи клиентов сохранены, синхронизация будет повторяться автоматически.", 60 * 60_000).catch(() => undefined);
      }
    }

    const known = new Set(ENTITY_SPECS.map((x) => x.entityType));
    const orphan = claimed.filter((c) => !known.has(c.entityType));
    if (orphan.length) {
      await prisma.syncQueue.updateMany({ where: { id: { in: orphan.map((o) => o.id) } }, data: { status: "FAILED", error: "unknown entityType" } });
    }

    if (reconcile) {
      try {
        await refreshSnapshots(io, now.toISOString());
        await setSetting("google_reconcile_at", { at: now.toISOString() });
      } catch (e) {
        logger.error("snapshot refresh failed", { operation: "sync_google", error: errorMessage(e) });
      }
    }
    return report;
  } finally {
    await releaseLease(LEASE).catch(() => undefined);
  }
}

async function failAll(claimed: SyncQueue[], e: unknown, report: SyncReport) {
  logger.error("google unavailable", { operation: "sync_google", error: errorMessage(e) });
  for (const type of new Set(claimed.map((c) => c.entityType))) {
    const items = claimed.filter((c) => c.entityType === type);
    report.failed += items.length;
    await failItems(items, type, errorMessage(e));
  }
  await notifyAdminsThrottled("google_sync", "⚠️ Google Таблица временно недоступна. Записи клиентов сохранены, синхронизация повторится автоматически.", 60 * 60_000).catch(() => undefined);
}

async function markSynced(entityType: string, ids: string[]) {
  if (!ids.length) return;
  const now = new Date();
  if (entityType === "booking") {
    await prisma.booking.updateMany({ where: { id: { in: ids } }, data: { syncStatus: "SYNCED", lastSyncedAt: now } });
  } else if (entityType === "client") {
    await prisma.client.updateMany({ where: { id: { in: ids } }, data: { lastSyncedAt: now } });
  }
}
