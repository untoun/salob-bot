import { env } from "@/lib/config/env";
import { safeEqual } from "./compare";

/** Vercel Cron передаёт `Authorization: Bearer $CRON_SECRET`. */
export function isCronAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice(7), env().CRON_SECRET);
}

export function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}
