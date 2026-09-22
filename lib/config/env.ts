import { z } from "zod";

const schema = z.object({
  MAX_BOT_TOKEN_PROD: z.string().optional(),
  MAX_BOT_TOKEN_DEV: z.string().optional(),
  MAX_BOT_TOKEN: z.string().optional(), // fallback для локальной разработки
  MAX_WEBHOOK_SECRET: z.string().regex(/^[a-zA-Z0-9_-]{5,256}$/),
  MAX_API_URL: z.string().url().default("https://platform-api2.max.ru"),
  MAX_EXTRA_CA_PEM: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_SHEET_ID: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_DAILY_LIMIT: z.coerce.number().int().positive().default(1000), // потолок AI-ответов в сутки (защита бюджета)

  ADMIN_MAX_USER_IDS: z.string().optional(), // MAX user_id администраторов через запятую (для уведомлений)
  CRON_SECRET: z.string().min(16),
  ADMIN_SESSION_SECRET: z.string().min(32),

  SALON_TIMEZONE: z.string().default("Asia/Yekaterinburg"),
  SALON_NAME: z.string().default("Салон"),
  SALON_PHONE: z.string().default(""),
  SALON_ADDRESS: z.string().default(""),
  PRIVACY_POLICY_URL: z.string().optional(),
  SALON_LEGAL_NAME: z.string().optional(), // юридическое лицо/ИП — оператор персональных данных
  SALON_HOURS: z.string().optional(), // «Пн–Сб 10:00–20:00»
  SALON_WEBSITE: z.string().url().optional(),
  SALON_SOCIAL_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Кэш только в пределах инстанса функции; состояния приложения тут нет. */
export function env(): Env {
  if (!cached) {
    // Пустая строка в .env (`KEY=`) = «не задано»: иначе необязательные URL-поля не проходили бы валидацию
    const source = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
    const parsed = schema.safeParse(source);
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      // значения не логируем
      throw new Error(`Invalid environment variables: ${keys}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** production-окружение Vercel использует PROD-токен, остальные — DEV. */
export function maxBotToken(): string {
  const e = env();
  const isProd = process.env.VERCEL_ENV === "production";
  const token = isProd ? e.MAX_BOT_TOKEN_PROD : (e.MAX_BOT_TOKEN_DEV ?? e.MAX_BOT_TOKEN);
  if (!token) {
    throw new Error(`MAX bot token is not configured for ${isProd ? "production" : "non-production"}`);
  }
  return token;
}

export function googlePrivateKey(): string | undefined {
  return env().GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
}

/** Ссылка на политику: явная переменная, иначе /privacy на production-домене Vercel */
export function privacyPolicyUrl(): string | undefined {
  const e = env();
  if (e.PRIVACY_POLICY_URL) return e.PRIVACY_POLICY_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}/privacy` : undefined;
}
