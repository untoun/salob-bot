import { after } from "next/server";
import { env } from "@/lib/config/env";
import { handleUpdate } from "@/lib/bot/router";
import { logger, errorMessage } from "@/lib/logging/logger";
import { deriveEventId, sha256 } from "@/lib/max/events";
import { updateSchema } from "@/lib/max/types";
import { claimEvent, markEvent } from "@/lib/max/webhook";
import { safeEqual } from "@/lib/security/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 256 * 1024;

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  if (!safeEqual(req.headers.get("x-max-bot-api-secret"), env().MAX_WEBHOOK_SECRET)) {
    logger.warn("webhook rejected: bad secret", { requestId });
    return new Response("Unauthorized", { status: 401 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response("Payload too large", { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) {
    // 200, чтобы MAX не повторял заведомо непонятное событие
    logger.warn("webhook payload not recognised", { requestId });
    return Response.json({ ok: true, ignored: true });
  }
  const update = parsed.data;

  const payloadHash = sha256(raw);
  const eventId = deriveEventId(update, payloadHash);

  let claimed: boolean;
  try {
    claimed = await claimEvent({ eventId, eventType: update.update_type, payloadHash });
  } catch (e) {
    // БД недоступна: отдаём 5xx, чтобы MAX повторил доставку позже
    logger.error("webhook claim failed", { requestId, eventId, error: errorMessage(e) });
    return new Response("Service unavailable", { status: 503 });
  }
  if (!claimed) {
    logger.info("duplicate webhook event skipped", { requestId, eventId });
    return Response.json({ ok: true, duplicate: true });
  }

  // Отвечаем 200 сразу; обработка продолжается после ответа.
  after(async () => {
    try {
      await handleUpdate(update, { requestId, eventId });
      await markEvent(eventId, "PROCESSED");
    } catch (e) {
      logger.error("webhook processing failed", { requestId, eventId, operation: update.update_type, error: errorMessage(e) });
      await markEvent(eventId, "FAILED", errorMessage(e)).catch(() => undefined);
    }
  });

  return Response.json({ ok: true });
}
