import type { BotState, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const TTL_MS = 24 * 60 * 60 * 1000;

export async function getSession(userId: string) {
  const s = await prisma.botSession.findUnique({ where: { userId } });
  if (!s || s.expiresAt < new Date()) return { state: "IDLE" as BotState, data: {} as Record<string, unknown> };
  return { state: s.state, data: (s.data ?? {}) as Record<string, unknown> };
}

export async function setSession(userId: string, state: BotState, data: Prisma.InputJsonObject = {}) {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.botSession.upsert({
    where: { userId },
    create: { userId, state, data, expiresAt },
    update: { state, data, expiresAt },
  });
}
