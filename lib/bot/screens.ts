import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { formatDuration, formatPrice } from "@/lib/utils/format";
import type { Button, Screen } from "@/lib/max/types";
import { isAiEnabled } from "@/lib/openai/client";
import { cb } from "./callbacks";

const btn = (text: string, payload: string): Button => ({ type: "callback", text, payload });

export function nav(back?: string): Button[][] {
  const row: Button[] = [];
  if (back) row.push(btn("⬅️ Назад", back));
  row.push(btn("🏠 Главное меню", cb.menu));
  return [row];
}

export function greeting(): Screen {
  return {
    text: "Здравствуйте! 👋\n\nЯ виртуальный администратор салона.\n\nПомогу подобрать услугу, выбрать мастера и записаться на удобное время.\n\nЧто вас интересует?",
    buttons: mainMenu().buttons,
  };
}

export function mainMenu(): Screen {
  return {
    text: "Главное меню. Что вас интересует?",
    buttons: [
      [btn("💇 Записаться", cb.bkStart)],
      [btn("✂️ Услуги", cb.services), btn("💰 Прайс", cb.price)],
      [btn("👩‍🦰 Мастера", cb.masters), btn("📸 Портфолио", cb.planned("portfolio"))],
      [btn("🔥 Акции", cb.promos), btn("📅 Моя запись", cb.myList)],
      [btn("📍 Контакты", cb.contacts), btn("💬 Задать вопрос", cb.faq)],
      [btn("👨‍💼 Связаться с администратором", cb.askAdmin)],
    ],
  };
}

export async function servicesScreen(): Promise<Screen> {
  const cats = await prisma.serviceCategory.findMany({
    where: { active: true, services: { some: { active: true, isAddon: false } } },
    orderBy: { sortOrder: "asc" },
  });
  if (!cats.length) return { text: "Список услуг скоро появится.", buttons: nav() };
  return {
    text: "Выберите категорию:",
    buttons: [...cats.map((c) => [btn(c.name, cb.category(c.id))]), ...nav()],
  };
}

export async function categoryScreen(id: string): Promise<Screen> {
  const cat = await prisma.serviceCategory.findFirst({
    where: { id, active: true },
    include: { services: { where: { active: true, isAddon: false }, orderBy: { sortOrder: "asc" } } },
  });
  if (!cat) return notFound(cb.services);
  return {
    text: cat.name,
    buttons: [
      ...cat.services.map((s) => [btn(`${s.name} · ${formatPrice(s.priceRub, s.priceFrom)}`, cb.service(s.id))]),
      ...nav(cb.services),
    ],
  };
}

export async function serviceScreen(id: string): Promise<Screen> {
  const s = await prisma.service.findFirst({ where: { id, active: true } });
  if (!s) return notFound(cb.services);
  const lines = [s.name, s.description, `⏱ ${formatDuration(s.durationMin)}`, `💰 ${formatPrice(s.priceRub, s.priceFrom)}`];
  return {
    text: lines.filter(Boolean).join("\n"),
    buttons: [[btn("💇 Записаться", cb.bkSvc(s.id))], ...nav(cb.category(s.categoryId))],
  };
}

export async function priceScreen(): Promise<Screen> {
  const cats = await prisma.serviceCategory.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: { services: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
  });
  const blocks = cats
    .filter((c) => c.services.length)
    .map((c) => `${c.name}\n${c.services.map((s) => `• ${s.name} — ${formatPrice(s.priceRub, s.priceFrom)}`).join("\n")}`);
  return { text: blocks.length ? `💰 Прайс\n\n${blocks.join("\n\n")}` : "Прайс скоро появится.", buttons: nav() };
}

export async function mastersScreen(): Promise<Screen> {
  const masters = await prisma.master.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  if (!masters.length) return { text: "Информация о мастерах скоро появится.", buttons: nav() };
  return {
    text: "Наши мастера:",
    buttons: [...masters.map((m) => [btn(m.specialization ? `${m.name} · ${m.specialization}` : m.name, cb.master(m.id))]), ...nav()],
  };
}

export async function masterScreen(id: string): Promise<Screen> {
  const m = await prisma.master.findFirst({ where: { id, active: true } });
  if (!m) return notFound(cb.masters);
  const lines = [
    m.name,
    m.specialization,
    m.experienceYears ? `Опыт: ${m.experienceYears} лет` : null,
    m.rating ? `⭐ ${m.rating.toFixed(1)}` : null,
    m.bio,
  ];
  return {
    text: lines.filter(Boolean).join("\n"),
    buttons: [[btn("💇 Записаться", cb.bkStart)], ...nav(cb.masters)],
  };
}

export async function promosScreen(): Promise<Screen> {
  const now = new Date();
  const promos = await prisma.promotion.findMany({
    where: { active: true, startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { endsAt: "asc" },
  });
  if (!promos.length) return { text: "Сейчас действующих акций нет. Загляните позже 😊", buttons: nav() };
  const text = promos
    .map((p) => [`🔥 ${p.title}`, p.discountText, p.description, p.conditions ? `Условия: ${p.conditions}` : null].filter(Boolean).join("\n"))
    .join("\n\n");
  return { text, buttons: nav() };
}

export function contactsScreen(): Screen {
  const e = env();
  const lines = [`📍 ${e.SALON_NAME}`, e.SALON_ADDRESS, e.SALON_PHONE ? `📞 ${e.SALON_PHONE}` : "", e.SALON_HOURS ? `🕐 ${e.SALON_HOURS}` : ""];
  const buttons: Button[][] = [];
  if (e.SALON_ADDRESS) {
    buttons.push([{ type: "link", text: "📍 Как добраться", url: `https://yandex.ru/maps/?text=${encodeURIComponent(e.SALON_ADDRESS)}` }]);
  }
  const links: Button[] = [];
  if (e.SALON_WEBSITE) links.push({ type: "link", text: "🌐 Сайт", url: e.SALON_WEBSITE });
  if (e.SALON_SOCIAL_URL) links.push({ type: "link", text: "💬 Соцсети", url: e.SALON_SOCIAL_URL });
  if (links.length) buttons.push(links);
  buttons.push([btn("👨‍💼 Написать администратору", cb.askAdmin)]);
  return { text: lines.filter(Boolean).join("\n"), buttons: [...buttons, ...nav()] };
}

export async function faqScreen(): Promise<Screen> {
  const items = await prisma.fAQ.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 12 });
  if (!items.length) return { text: "Напишите нам — администратор ответит.", buttons: [[btn("👨‍💼 Спросить администратора", cb.askAdmin)], ...nav()] };
  return {
    text: "Частые вопросы. Выберите тему или спросите у помощника:",
    buttons: [...(isAiEnabled() ? [[btn("✨ Подобрать услугу", cb.aiStart)]] : []), ...items.map((f) => [btn(f.question.slice(0, 60), cb.faqItem(f.id))]), [btn("👨‍💼 Спросить администратора", cb.askAdmin)], ...nav()],
  };
}

export async function faqItemScreen(id: string): Promise<Screen> {
  const f = await prisma.fAQ.findFirst({ where: { id, active: true } });
  if (!f) return notFound(cb.faq);
  return { text: `${f.question}\n\n${f.answer}`, buttons: nav(cb.faq) };
}

export function plannedScreen(): Screen {
  const phone = env().SALON_PHONE;
  return {
    text: `Этот раздел скоро заработает.${phone ? `\n\nА пока можно позвонить нам: ${phone}` : ""}`,
    buttons: nav(),
  };
}

export function notFound(back?: string): Screen {
  return { text: "Не нашёл такой пункт. Возможно, он изменился.", buttons: nav(back) };
}

export function technicalProblem(): Screen {
  return {
    text: "Сейчас возникла техническая проблема. Попробуйте ещё раз через несколько минут или свяжитесь с администратором.",
    buttons: nav(),
  };
}
