import tls from "node:tls";
import { Agent, fetch as undiciFetch } from "undici";
import { env, maxBotToken } from "@/lib/config/env";
import type { Button } from "./types";

export class MaxApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "MaxApiError";
  }
}

let agent: Agent | undefined;

/**
 * platform-api2.max.ru использует сертификат Минцифры. Его нужно добавить к доверенным
 * (MAX_EXTRA_CA_PEM), проверка TLS НЕ отключается.
 */
function getAgent(): Agent | undefined {
  const extra = env().MAX_EXTRA_CA_PEM;
  if (!extra) return undefined;
  if (!agent) {
    const pem = extra.includes("BEGIN CERTIFICATE") ? extra : Buffer.from(extra, "base64").toString("utf8");
    agent = new Agent({ connect: { ca: [...tls.rootCertificates, pem] } });
  }
  return agent;
}

interface RequestOptions {
  query?: Record<string, string | number>;
  body?: unknown;
  retries?: number;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, env().MAX_API_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));

  const maxAttempts = (opts.retries ?? 2) + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await undiciFetch(url, {
        method,
        headers: {
          Authorization: maxBotToken(), // только заголовок, никогда query
          "Content-Type": "application/json",
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(8_000),
        dispatcher: getAgent(),
      });

      if (res.status === 429 && attempt < maxAttempts) {
        const wait = Math.min(Number(res.headers.get("retry-after") ?? 1), 3);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        // тело ответа не пробрасываем пользователю; в логи попадёт только статус
        throw new MaxApiError(res.status, `MAX API ${method} ${path} -> ${res.status}`, res.status >= 500 || res.status === 429);
      }
      // Успех уже случился: нечитаемое тело не должно приводить к повтору (иначе клиент получит дубль сообщения)
      let parsed: unknown = {};
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = {};
        }
      }
      return parsed as T;
    } catch (e) {
      lastError = e;
      const retryable = e instanceof MaxApiError ? e.retryable : true; // сеть/таймаут
      if (!retryable || attempt >= maxAttempts) break;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastError;
}

function keyboard(buttons?: Button[][]) {
  if (!buttons?.length) return undefined;
  return [{ type: "inline_keyboard", payload: { buttons } }];
}

export type Target = { userId: number } | { chatId: number };

export interface OutMessage {
  text: string;
  buttons?: Button[][];
  notify?: boolean;
}

function body(m: OutMessage) {
  return { text: m.text.slice(0, 4000), attachments: keyboard(m.buttons), notify: m.notify };
}

/** POST /messages */
export function sendMessage(target: Target, msg: OutMessage) {
  const query: Record<string, number> = "userId" in target ? { user_id: target.userId } : { chat_id: target.chatId };
  return request<unknown>("POST", "/messages", { query, body: body(msg), retries: 1 });
}

/** POST /answers — редактирует сообщение с кнопкой, на которую нажали */
export function answerCallback(callbackId: string, msg: OutMessage) {
  const { text, attachments } = body(msg);
  return request<{ success: boolean; message?: string }>("POST", "/answers", {
    query: { callback_id: callbackId },
    body: { message: { text, attachments } },
    retries: 1,
  });
}

/** Пустой ответ на callback: снимает индикатор загрузки на кнопке */
export function ackCallback(callbackId: string) {
  return request<{ success: boolean }>("POST", "/answers", {
    query: { callback_id: callbackId },
    body: {},
    retries: 1,
  });
}

/** PATCH /me/commands (до 32 команд) */
export function setCommands(commands: { name: string; description: string }[]) {
  return request<unknown>("PATCH", "/me/commands", { body: { commands } });
}

/** POST /subscriptions */
export function subscribe(url: string, secret: string, updateTypes: string[]) {
  return request<{ success: boolean; message?: string }>("POST", "/subscriptions", {
    body: { url, secret, update_types: updateTypes },
  });
}

/** GET /subscriptions */
export function getSubscriptions() {
  return request<unknown>("GET", "/subscriptions");
}

/** GET /me */
export function getMe() {
  return request<unknown>("GET", "/me");
}
