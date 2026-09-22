import { prisma } from "@/lib/db/prisma";
import { logger, errorMessage } from "@/lib/logging/logger";

/**
 * Счётчик в фиксированном окне, атомарно в PostgreSQL (одна инструкция).
 * При сбое БД пропускаем запрос (fail-open), чтобы не блокировать клиентов.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; count: number }> {
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("key", "windowStart", "count")
      VALUES (${key}, now(), 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::int) THEN 1 ELSE "RateLimit"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSec}::int) THEN now() ELSE "RateLimit"."windowStart" END
      RETURNING "count"`;
    const count = Number(rows[0]?.count ?? 1);
    return { allowed: count <= limit, count };
  } catch (e) {
    logger.warn("rate limit check failed (allowing)", { error: errorMessage(e) });
    return { allowed: true, count: 0 };
  }
}
