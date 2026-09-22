/**
 * Регистрирует webhook и команды бота в MAX.
 * Запуск: npm run max:setup -- https://ВАШ-ДОМЕН.vercel.app
 * Использует токен/секрет из .env (или переменных окружения) — для PROD задайте VERCEL_ENV=production.
 */
import { env } from "@/lib/config/env";
import { getMe, getSubscriptions, setCommands, subscribe } from "@/lib/max/client";

const COMMANDS = [
  { name: "start", description: "Начать" },
  { name: "menu", description: "Главное меню" },
  { name: "booking", description: "Записаться" },
  { name: "services", description: "Услуги" },
  { name: "masters", description: "Мастера" },
  { name: "promotions", description: "Акции" },
  { name: "mybooking", description: "Моя запись" },
  { name: "contacts", description: "Контакты" },
  { name: "help", description: "Помощь" },
];

async function main() {
  const base = process.argv[2];
  if (!base?.startsWith("https://")) throw new Error("Укажите HTTPS-адрес: npm run max:setup -- https://example.vercel.app");
  const url = `${base.replace(/\/$/, "")}/api/max/webhook`;

  console.log("Бот:", JSON.stringify(await getMe()));
  const sub = await subscribe(url, env().MAX_WEBHOOK_SECRET, ["message_created", "message_callback", "bot_started", "bot_stopped", "dialog_removed"]);
  console.log("subscribe:", JSON.stringify(sub));
  console.log("commands:", JSON.stringify(await setCommands(COMMANDS)));
  console.log("subscriptions:", JSON.stringify(await getSubscriptions()));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
