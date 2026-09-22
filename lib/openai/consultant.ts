import { z } from "zod";
import { guardReply, scrubUserText } from "./guard";
import { catalogBlock, systemPrompt, type Catalog, type CatalogService, type ChatMessage, type Turn } from "./prompt";

export class AiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

const outputSchema = z.object({
  reply: z.string(),
  suggested_service_ids: z.array(z.string()).default([]),
  handoff_to_admin: z.boolean().default(false),
  ready_to_book: z.boolean().default(false),
});

export interface ConsultResult {
  reply: string;
  services: CatalogService[];
  handoff: boolean;
  readyToBook: boolean;
  guarded: boolean;
  guardReason?: string;
}

export const MAX_HISTORY = 6;

export function buildMessages(catalog: Catalog, history: Turn[], userText: string): ChatMessage[] {
  return [
    { role: "system", content: systemPrompt(catalog.salon.name) },
    { role: "system", content: catalogBlock(catalog) },
    ...history.slice(-MAX_HISTORY).map((t): ChatMessage => ({ role: t.r === "u" ? "user" : "assistant", content: t.t.slice(0, 500) })),
    { role: "user", content: userText },
  ];
}

const FALLBACK_WITH_SERVICES = "Подобрал для вас варианты ниже 👇 Актуальные цены и свободное время покажу при записи.";
const FALLBACK_ASK_MORE = "Расскажите, пожалуйста, чуть подробнее: какая сейчас длина волос, какой результат хотите и нужен ли цвет?";

/**
 * Ядро консультанта. `ask` — вызов модели (внедряется, чтобы тестировать без сети).
 * Модель ничего не «решает»: id услуг сверяются с каталогом из БД, ответ проходит guardReply.
 */
export async function consult(input: {
  catalog: Catalog;
  history: Turn[];
  text: string;
  ask: (messages: ChatMessage[]) => Promise<string>;
}): Promise<ConsultResult> {
  const userText = scrubUserText(input.text);
  if (!userText) throw new AiError("empty_input");

  const raw = await input.ask(buildMessages(input.catalog, input.history, userText));
  let parsed: z.infer<typeof outputSchema>;
  try {
    parsed = outputSchema.parse(JSON.parse(raw));
  } catch {
    throw new AiError("bad_output");
  }

  const byId = new Map(input.catalog.services.map((s) => [s.id, s]));
  const services = [...new Set(parsed.suggested_service_ids)]
    .map((id) => byId.get(id))
    .filter((s): s is CatalogService => Boolean(s))
    .slice(0, 3);

  let reply = parsed.reply.trim().slice(0, 700);
  const verdict = guardReply(reply, input.catalog.services.map((s) => s.priceRub));
  const guarded = !verdict.ok || !reply;
  if (guarded) reply = services.length ? FALLBACK_WITH_SERVICES : FALLBACK_ASK_MORE;

  return {
    reply,
    services,
    handoff: parsed.handoff_to_admin,
    readyToBook: parsed.ready_to_book && services.length > 0,
    guarded,
    guardReason: verdict.ok ? undefined : verdict.reason,
  };
}
