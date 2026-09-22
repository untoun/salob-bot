/** Удаляет из текста клиента телефоны и e-mail перед отправкой в OpenAI, ограничивает длину. */
export function scrubUserText(input: string): string {
  return input
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[номер]" : m)) // «2 500 - 3 000» (бюджет) остаётся
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export type GuardResult = { ok: true } | { ok: false; reason: "time" | "booking_claim" | "slots" | "price" };

/**
 * Последняя линия обороны: если модель всё же «пообещала» время, запись, слоты
 * или назвала цену, которой нет в каталоге — ответ заменяется безопасным.
 */
export function guardReply(reply: string, allowedPrices: number[]): GuardResult {
  if (/\b([01]?\d|2[0-3]):[0-5]\d\b/.test(reply)) return { ok: false, reason: "time" };
  // Внимание: \b и \w в JS не понимают кириллицу, поэтому флаг u и \p{L}
  if (/(записал[аи]?(?!\p{L})|запись\s+(подтвержден|оформлен)|подтвердил[аи]?(?!\p{L})|вы\s+записаны)/iu.test(reply)) return { ok: false, reason: "booking_claim" };
  if (/(свободн\p{L}*\s+(окошк|время|слот|места)|есть\s+(окошк|свободн)|окошк\p{L}*\s+(есть|свободн))/iu.test(reply)) return { ok: false, reason: "slots" };
  for (const m of reply.matchAll(/(\d[\d\s\u00a0.,]*)\s*(?:₽|руб|р\.)/gi)) {
    const n = Number((m[1] ?? "").replace(/\D/g, ""));
    if (!allowedPrices.includes(n)) return { ok: false, reason: "price" };
  }
  return { ok: true };
}
