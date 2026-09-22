import { prisma } from "@/lib/db/prisma";

/**
 * Простая аренда (lease) на базе таблицы Setting: не даёт двум запускам cron
 * одновременно писать в таблицу (иначе возможны дубли строк).
 * Атомарно: строка создаётся/перехватывается, только если прежняя аренда истекла.
 */
export async function acquireLease(name: string, ttlMs: number): Promise<boolean> {
  const key = `lease:${name}`;
  const value = JSON.stringify({ until: new Date(Date.now() + ttlMs).toISOString() });
  const affected = await prisma.$executeRaw`
    INSERT INTO "Setting" ("key", "value", "updatedAt")
    VALUES (${key}, ${value}::jsonb, now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value", "updatedAt" = now()
      WHERE ("Setting"."value"->>'until')::timestamptz < now()`;
  return affected === 1;
}

export async function releaseLease(name: string): Promise<void> {
  const value = JSON.stringify({ until: new Date(0).toISOString() });
  await prisma.$executeRaw`UPDATE "Setting" SET "value" = ${value}::jsonb, "updatedAt" = now() WHERE "key" = ${`lease:${name}`}`;
}
