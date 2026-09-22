type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE = /token|secret|password|private_?key|api_?key|authorization|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? "[REDACTED]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

/** Маска телефона для логов: +79****1234 */
export function maskPhone(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return phone.length <= 6 ? "***" : `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export interface LogFields {
  requestId?: string;
  eventId?: string;
  bookingId?: string;
  userId?: string;
  operation?: string;
  status?: string;
  duration?: number;
  error?: string;
  [key: string]: unknown;
}

export function log(level: Level, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...(redact(fields) as object) });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export const logger = {
  debug: (m: string, f?: LogFields) => log("debug", m, f),
  info: (m: string, f?: LogFields) => log("info", m, f),
  warn: (m: string, f?: LogFields) => log("warn", m, f),
  error: (m: string, f?: LogFields) => log("error", m, f),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
}
