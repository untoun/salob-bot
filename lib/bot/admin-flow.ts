import { DateTime } from "luxon";
import { applyBookingStatus } from "@/lib/booking/status";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import { sendMessage } from "@/lib/max/client";
import type { Button, Screen } from "@/lib/max/types";
import { adminMaxUserIds } from "@/lib/notifications/admin";
import { processDueNotifications } from "@/lib/notifications/sender";
import { cb, type AdminAction } from "./callbacks";
import type { Actor } from "./booking-flow";
import { getSession, setSession } from "./session";
import { mainMenu, nav } from "./screens";

const btn = (text: string, payload: string, intent?: "positive" | "negative"): Button => ({ type: "callback", text, payload, intent });

export async function isAdmin(maxUserId: number): Promise<boolean> {
  return (await adminMaxUserIds()).includes(maxUserId);
}

const DENIED: Screen = { text: "Недостаточно прав.", buttons: nav() };

async function describe(bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { client: true, service: true, master: true } });
  if (!b) return null;
  const dt = DateTime.fromJSDate(b.startsAt, { zone: env().SALON_TIMEZONE });
  return { b, label: `${b.client.name}, ${b.service.name}, ${dt.toFormat("dd.MM HH:mm")} (${b.master.name})` };
}

export async function handleAdminAction(action: AdminAction, actor: Actor): Promise<Screen> {
  // Роль проверяется на сервере при КАЖДОМ действии: payload кнопки доверять нельзя
  if (!(await isAdmin(actor.maxUserId))) {
    logger.warn("admin action denied", { operation: action.kind, userId: actor.userId });
    return DENIED;
  }

  switch (action.kind) {
    case "admCancelAsk": {
      const d = await describe(action.id);
      if (!d) return { text: "Запись не найдена.", buttons: nav() };
      return {
        text: `Отменить запись?\n\n${d.label}\n\nКлиент получит уведомление.`,
        buttons: [[btn("Да, отменить", cb.admCancelYes(action.id), "negative"), btn("Нет", cb.menu)]],
      };
    }
    case "admCancelYes": {
      const r = await applyBookingStatus(action.id, "CANCELLED", "DB");
      if (r === "applied") {
        await processDueNotifications({ bookingId: action.id }).catch((e) => logger.warn("notify client failed", { error: errorMessage(e) }));
        return { text: "Запись отменена. Клиенту отправлено уведомление.", buttons: nav() };
      }
      return { text: r === "noop" ? "Запись уже отменена." : "Эту запись нельзя отменить (она уже завершена или перенесена).", buttons: nav() };
    }
    case "admConfirm": {
      const r = await applyBookingStatus(action.id, "CONFIRMED", "DB");
      return { text: r === "applied" ? "Запись подтверждена ✅" : "Статус записи не изменён.", buttons: nav() };
    }
    case "admReply": {
      const target = await prisma.user.findUnique({ where: { id: action.id } });
      if (!target) return { text: "Клиент не найден.", buttons: nav() };
      await setSession(actor.userId, "ADMIN_REPLY", { to: target.id });
      return { text: `Напишите ответ клиенту${target.name ? ` (${target.name})` : ""} одним сообщением.`, buttons: nav() };
    }
  }
}

// ───────── вопрос администратору ─────────

export async function startAskAdmin(actor: Actor): Promise<Screen> {
  await setSession(actor.userId, "ASK_ADMIN");
  return { text: "Напишите ваш вопрос одним сообщением — я передам его администратору.", buttons: nav() };
}

export async function handleAskText(actor: Actor, text: string): Promise<Screen> {
  const question = text.trim().slice(0, 1000);
  if (!question) return { text: "Напишите ваш вопрос текстом.", buttons: nav() };

  const user = await prisma.user.findUnique({ where: { id: actor.userId }, include: { client: true } });
  const admins = await adminMaxUserIds();
  const phone = env().SALON_PHONE;
  const fallback = `Не получилось передать вопрос.${phone ? ` Позвоните нам: ${phone}` : " Попробуйте позже."}`;
  if (!user || !admins.length) return { text: fallback, buttons: nav() };

  const header = [
    "💬 Вопрос от клиента",
    `Имя: ${user.client?.name ?? user.name ?? "—"}${user.username ? ` (@${user.username})` : ""}`,
    user.client?.phone ? `Телефон: ${user.client.phone}` : null,
    "",
    question,
  ].filter((x) => x !== null).join("\n");

  let delivered = 0;
  for (const id of admins) {
    try {
      await sendMessage({ userId: id }, { text: header, buttons: [[btn("✍️ Ответить", cb.admReply(user.id))]] });
      delivered++;
    } catch (e) {
      logger.warn("question delivery failed", { operation: "ask_admin", error: errorMessage(e) });
    }
  }
  await setSession(actor.userId, "IDLE");
  if (!delivered) return { text: fallback, buttons: nav() };
  await prisma.analyticsEvent.create({ data: { userId: actor.userId, type: "admin_question" } }).catch(() => undefined);
  return { text: "Спасибо! Я передал вопрос администратору — ответим здесь, в чате.", buttons: nav() };
}

/** Сообщение администратора в состоянии ADMIN_REPLY -> клиенту */
export async function handleAdminReplyText(actor: Actor, text: string): Promise<Screen | null> {
  if (!(await isAdmin(actor.maxUserId))) return null;
  const s = await getSession(actor.userId);
  const to = typeof s.data.to === "string" ? s.data.to : null;
  const answer = text.trim().slice(0, 2000);
  if (!to || !answer) return null;
  const target = await prisma.user.findUnique({ where: { id: to } });
  if (!target) return { text: "Клиент не найден.", buttons: nav() };
  try {
    await sendMessage({ userId: Number(target.maxUserId) }, { text: `💬 Ответ администратора:\n\n${answer}`, buttons: mainMenu().buttons.slice(0, 1) });
  } catch (e) {
    logger.warn("admin reply failed", { operation: "admin_reply", error: errorMessage(e) });
    return { text: "Не удалось доставить ответ клиенту. Попробуйте ещё раз позже.", buttons: nav() };
  }
  await setSession(actor.userId, "IDLE");
  return { text: "Ответ отправлен ✅", buttons: nav() };
}
