import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { isGoogleConfigured, pingGoogle } from "@/lib/google/client";
import { getMe } from "@/lib/max/client";
import { safeEqual } from "@/lib/security/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Status = "ok" | "error" | "not_configured";

async function check(fn: () => Promise<unknown>): Promise<Status> {
  try {
    await fn();
    return "ok";
  } catch {
    return "error"; // текст ошибки наружу не отдаём
  }
}

/**
 * GET /api/health — публичный: {status, database}.
 * GET /api/health?deep=1 с `Authorization: Bearer <CRON_SECRET>` — дополнительно MAX API и Google Sheets.
 */
export async function GET(req: Request) {
  const database = await check(() => prisma.$queryRaw`SELECT 1`);
  const base = { status: database === "ok" ? "ok" : "degraded", database };

  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (!deep) return Response.json(base, { status: database === "ok" ? 200 : 503 });

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || !safeEqual(auth.slice(7), env().CRON_SECRET)) return new Response("Unauthorized", { status: 401 });

  const [max, google] = await Promise.all([
    check(getMe),
    isGoogleConfigured() ? check(pingGoogle) : Promise.resolve<Status>("not_configured"),
  ]);
  const openai: Status = env().OPENAI_API_KEY ? "ok" : "not_configured"; // без реального запроса, чтобы не тратить бюджет
  const status = database === "ok" && max === "ok" && google !== "error" ? "ok" : "degraded";
  return Response.json({ status, database, max, google, openai: openai === "ok" ? "configured" : openai }, { status: status === "ok" ? 200 : 503 });
}
