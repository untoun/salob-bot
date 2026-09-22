import OpenAI from "openai";
import { env } from "@/lib/config/env";
import { OUTPUT_SCHEMA, type ChatMessage } from "./prompt";

// Ключ читается только на сервере. Никогда не попадает в браузер (нет NEXT_PUBLIC_*).
export function isAiEnabled(): boolean {
  return Boolean(env().OPENAI_API_KEY);
}

let client: OpenAI | undefined;

function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: 12_000, maxRetries: 1 });
  return client;
}

/** Возвращает JSON-строку по OUTPUT_SCHEMA */
export async function askModel(messages: ChatMessage[]): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: env().OPENAI_MODEL,
    messages,
    max_completion_tokens: 500,
    response_format: { type: "json_schema", json_schema: { name: "salon_reply", strict: true, schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
  });
  return res.choices[0]?.message?.content ?? "";
}
