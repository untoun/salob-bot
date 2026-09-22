import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getSetting, setSetting } from "@/lib/db/settings";
import { errorMessage, logger } from "@/lib/logging/logger";
import { sendMessage } from "@/lib/max/client";
import type { Button } from "@/lib/max/types";

export async function adminMaxUserIds(): Promise<number[]> {
  const fromEnv = (env().ADMIN_MAX_USER_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isSafeInteger(n) && n > 0);
  const admins = await prisma.admin.findMany({
    where: { active: true, role: { in: ["SUPER_ADMIN", "ADMIN"] }, maxUserId: { not: null } },
    select: { maxUserId: true },
  });
  const fromDb = admins.map((a) => Number(a.maxUserId));
  return [...new Set([...fromEnv, ...fromDb])];
}

export async function notifyAdmins(text: string, buttons?: Button[][]): Promise<number> {
  let sent = 0;
  for (const id of await adminMaxUserIds()) {
    try {
      await sendMessage({ userId: id }, { text, buttons });
      sent++;
    } catch (e) {
      logger.warn("admin notification failed", { operation: "notify_admin", error: errorMessage(e) });
    }
  }
  return sent;
}

/** Не чаще одного раза за ttl на ключ (чтобы не спамить при длительной аварии) */
export async function notifyAdminsThrottled(key: string, text: string, ttlMs: number): Promise<void> {
  const settingKey = `admin_alert:${key}`;
  const last = await getSetting<{ at: string }>(settingKey);
  if (last && Date.now() - new Date(last.at).getTime() < ttlMs) return;
  await setSetting(settingKey, { at: new Date().toISOString() });
  await notifyAdmins(text);
}
