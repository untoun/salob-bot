import type { Prisma } from "@prisma/client";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import type { Button, Screen } from "@/lib/max/types";
import { AiError, consult } from "@/lib/openai/consultant";
import { askModel, isAiEnabled } from "@/lib/openai/client";
import { loadCatalog } from "@/lib/openai/catalog";
import type { Turn } from "@/lib/openai/prompt";
import { rateLimit } from "@/lib/security/rate-limit";
import { formatDuration, formatPrice } from "@/lib/utils/format";
import type { Actor } from "./booking-flow";
import { cb } from "./callbacks";
import { mainMenu, nav } from "./screens";
import { getSession, setSession } from "./session";

const btn = (text: string, payload: string): Button => ({ type: "callback", text, payload });

function parseHistory(v: unknown): Turn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Turn => typeof x === "object" && x !== null && (x as Turn).r !== undefined && ["u", "a"].includes((x as Turn).r) && typeof (x as Turn).t === "string")
    .slice(-6);
}

/** OpenAI недоступен/лимит исчерпан: бот продолжает работать без AI */
export function aiUnavailable(): Screen {
  const phone = env().SALON_PHONE;
  return {
    text: `Сейчас не получается подобрать услугу автоматически. Выберите нужное в меню или напишите администратору${phone ? `, либо позвоните: ${phone}` : ""}.`,
    buttons: [[btn("✂️ Услуги", cb.services), btn("💇 Записаться", cb.bkStart)], [btn("👨‍💼 Спросить администратора", cb.askAdmin)], ...nav()],
  };
}

export async function startAi(actor: Actor): Promise<Screen> {
  if (!isAiEnabled()) return aiUnavailable();
  await setSession(actor.userId, "AI_CHAT", { history: [] });
  return {
    text: "Помогу подобрать услугу ✨\n\nРасскажите, что хотите изменить. Например: «хочу освежить причёску, волосы до плеч, цвет менять не хочу».",
    buttons: nav(),
  };
}

export async function handleAiText(actor: Actor, text: string): Promise<Screen> {
  if (!isAiEnabled()) return mainMenu();

  const perUser = await rateLimit(`ai:u:${actor.maxUserId}`, 8, 300);
  if (!perUser.allowed) return { text: "Вы пишете слишком часто. Подождите пару минут или выберите нужное в меню.", buttons: nav() };
  const day = new Date().toISOString().slice(0, 10);
  const perDay = await rateLimit(`ai:day:${day}`, env().AI_DAILY_LIMIT, 86_400);
  if (!perDay.allowed) return aiUnavailable();

  const session = await getSession(actor.userId);
  const history = parseHistory(session.data.history);

  let result;
  try {
    const catalog = await loadCatalog();
    result = await consult({ catalog, history, text, ask: askModel });
  } catch (e) {
    if (e instanceof AiError && e.message === "empty_input") return mainMenu();
    // текст ошибки и подробности пользователю не показываем
    logger.error("ai consult failed", { operation: "ai_consult", userId: actor.userId, error: errorMessage(e) });
    return aiUnavailable();
  }
  if (result.guarded) logger.warn("ai reply replaced by guard", { operation: "ai_guard", userId: actor.userId, status: result.guardReason });

  const next: Turn[] = [...history, { r: "u" as const, t: text.slice(0, 500) }, { r: "a" as const, t: result.reply }].slice(-6);
  await setSession(actor.userId, "AI_CHAT", { history: next } as unknown as Prisma.InputJsonObject);
  await prisma.analyticsEvent.create({ data: { userId: actor.userId, type: "ai_message", data: { suggested: result.services.length, handoff: result.handoff } } }).catch(() => undefined);

  // Цены и длительность добавляет КОД из БД, а не модель
  const details = result.services.map((s) => `• ${s.name} — ${formatPrice(s.priceRub, s.priceFrom)}, ${formatDuration(s.durationMin)}`).join("\n");
  const buttons: Button[][] = result.services.map((s) => [btn(`💇 Записаться: ${s.name}`.slice(0, 60), cb.bkSvc(s.id))]);
  if (result.readyToBook && !buttons.length) buttons.push([btn("💇 Записаться", cb.bkStart)]);
  if (result.handoff) buttons.push([btn("👨‍💼 Связаться с администратором", cb.askAdmin)]);
  return { text: details ? `${result.reply}\n\n${details}` : result.reply, buttons: [...buttons, ...nav()] };
}
