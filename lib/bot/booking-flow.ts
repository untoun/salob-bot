import type { Prisma } from "@prisma/client";
import { getAvailableDates, getSlotsForMasters } from "@/lib/booking/availability";
import { BookingValidationError, SlotTakenError } from "@/lib/booking/errors";
import { cancelBooking, createBooking, findOwnBooking, listUpcoming, type BookingWithNames } from "@/lib/booking/service";
import { env, privacyPolicyUrl } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger, maskPhone } from "@/lib/logging/logger";
import type { Button, Screen } from "@/lib/max/types";
import { dateButtonLabel, formatDateRu, formatTimeLocal, isValidDateISO, minutesToHHmm, nowLocal } from "@/lib/utils/time";
import { formatDuration, formatPrice } from "@/lib/utils/format";
import { normalizePhone, validateName } from "@/lib/utils/validation";
import { cb, type BookingAction } from "./callbacks";
import { getSession, setSession } from "./session";
import { mainMenu, nav, technicalProblem } from "./screens";
import { notifyAdminsBooking } from "@/lib/notifications/admin-events";

export interface Actor {
  userId: string;
  maxUserId: number;
}

interface Data {
  serviceId?: string;
  addon?: string;
  masterId?: string;
  date?: string;
  minutes?: number;
  name?: string;
  phone?: string;
  rescheduleFrom?: string;
}

const btn = (text: string, payload: string, intent?: "positive" | "negative"): Button => ({ type: "callback", text, payload, intent });
const save = (a: Actor, state: Parameters<typeof setSession>[1], d: Data) => setSession(a.userId, state, d as Prisma.InputJsonObject);
const chunk = <T,>(arr: T[], n: number): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function restart(a: Actor, note = "Давайте начнём заново."): Promise<Screen> {
  await setSession(a.userId, "IDLE");
  const m = mainMenu();
  return { text: `${note}\n\n${m.text}`, buttons: m.buttons };
}

// ───────── данные предложения ─────────

async function loadOffer(d: Data) {
  if (!d.serviceId) return null;
  const service = await prisma.service.findFirst({ where: { id: d.serviceId, active: true, isAddon: false } });
  if (!service) return null;
  const addon = d.addon && d.addon !== "0" ? await prisma.service.findFirst({ where: { id: d.addon, active: true, isAddon: true } }) : null;
  return {
    service,
    addon,
    durationMin: service.durationMin + (addon?.durationMin ?? 0),
    priceRub: service.priceRub + (addon?.priceRub ?? 0),
    priceFrom: service.priceFrom || !!addon?.priceFrom,
  };
}

const mastersOf = (serviceId: string) =>
  prisma.master.findMany({ where: { active: true, services: { some: { serviceId } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });

async function masterIds(d: Data): Promise<string[]> {
  if (!d.serviceId || !d.masterId) return [];
  return d.masterId === "any" ? (await mastersOf(d.serviceId)).map((m) => m.id) : [d.masterId];
}

export function bookingCard(b: Pick<BookingWithNames, "startsAt" | "priceRub" | "priceFrom"> & { service: { name: string }; master: { name: string } }): string {
  return [`💇 ${b.service.name}`, `👩 ${b.master.name}`, `📅 ${formatDateRu(b.startsAt)}`, `🕐 ${formatTimeLocal(b.startsAt)}`, `💰 ${formatPrice(b.priceRub, b.priceFrom)}`].join("\n");
}

function mapLink(): Button[] {
  const addr = env().SALON_ADDRESS;
  return addr ? [{ type: "link", text: "📍 Адрес", url: `https://yandex.ru/maps/?text=${encodeURIComponent(addr)}` }] : [];
}

// ───────── шаги записи ─────────

async function categoriesStep(a: Actor, d: Data): Promise<Screen> {
  await save(a, "SELECT_CATEGORY", d);
  const cats = await prisma.serviceCategory.findMany({
    where: { active: true, services: { some: { active: true, isAddon: false } } },
    orderBy: { sortOrder: "asc" },
  });
  if (!cats.length) return { text: "Запись скоро откроется.", buttons: nav() };
  return { text: "Выберите категорию услуги:", buttons: [...cats.map((c) => [btn(c.name, cb.bkCat(c.id))]), ...nav()] };
}

async function servicesStep(a: Actor, categoryId: string): Promise<Screen> {
  const cat = await prisma.serviceCategory.findFirst({
    where: { id: categoryId, active: true },
    include: { services: { where: { active: true, isAddon: false }, orderBy: { sortOrder: "asc" } } },
  });
  if (!cat) return categoriesStep(a, {});
  await save(a, "SELECT_SERVICE", {});
  return {
    text: cat.name,
    buttons: [...cat.services.map((s) => [btn(`${s.name} · ${formatPrice(s.priceRub, s.priceFrom)}`, cb.bkSvc(s.id))]), ...nav(cb.bkBack("cat"))],
  };
}

async function masterStep(a: Actor, d: Data, fromBack = false): Promise<Screen> {
  const service = d.serviceId ? await prisma.service.findFirst({ where: { id: d.serviceId, active: true } }) : null;
  if (!service) return categoriesStep(a, {});
  const masters = await mastersOf(service.id);
  if (!masters.length) return { text: "Для этой услуги пока нет доступных мастеров. Свяжитесь с администратором.", buttons: nav(cb.bkBack("cat")) };
  if (masters.length === 1 && masters[0]) {
    if (fromBack) return servicesStep(a, service.categoryId);
    return dateStep(a, { ...d, masterId: masters[0].id });
  }
  await save(a, "SELECT_MASTER", d);
  return {
    text: "Выберите мастера:",
    buttons: [[btn("Любой мастер", cb.bkMaster("any"))], ...masters.map((m) => [btn(m.name, cb.bkMaster(m.id))]), ...nav(cb.bkBack("svc"))],
  };
}

async function dateStep(a: Actor, d: Data): Promise<Screen> {
  const offer = await loadOffer(d);
  const ids = await masterIds(d);
  if (!offer || !ids.length) return restart(a);
  const dates = await getAvailableDates(ids, offer.durationMin, { days: 14, excludeBookingId: d.rescheduleFrom });
  const back = d.rescheduleFrom ? cb.myItem(d.rescheduleFrom) : cb.bkBack("master");
  await save(a, d.rescheduleFrom ? "RESCHEDULE_DATE" : "SELECT_DATE", { ...d, date: undefined, minutes: undefined });
  if (!dates.length) {
    const phone = env().SALON_PHONE;
    return { text: `На ближайшие 2 недели свободного времени нет.${phone ? `\nПозвоните нам: ${phone}` : ""}`, buttons: nav(back) };
  }
  return {
    text: "Выберите дату:",
    buttons: [...chunk(dates.slice(0, 12).map((x) => btn(dateButtonLabel(x), cb.bkDate(x))), 3), ...nav(back)],
  };
}

async function timeStep(a: Actor, d: Data, notice?: string): Promise<Screen> {
  const offer = await loadOffer(d);
  const ids = await masterIds(d);
  if (!offer || !ids.length || !d.date) return restart(a);
  const slots = await getSlotsForMasters(ids, d.date, offer.durationMin, d.rescheduleFrom);
  if (!slots.length) {
    return { ...(await dateStep(a, d)), text: `${notice ?? "На эту дату свободного времени не осталось."}\n\nВыберите другую дату:` };
  }
  await save(a, d.rescheduleFrom ? "RESCHEDULE_TIME" : "SELECT_TIME", d);
  return {
    text: `${notice ? `${notice}\n\n` : ""}Свободное время на ${formatDateRu(d.date)}:`,
    buttons: [...chunk(slots.slice(0, 24).map((m) => btn(minutesToHHmm(m), cb.bkTime(m))), 4), ...nav(cb.bkBack("date"))],
  };
}

const CONSENT_NOTE =
  "Указывая номер телефона, вы даёте согласие на обработку персональных данных (имя, телефон, история записей) для организации записи и напоминаний. Данные можно удалить по запросу у администратора.";

async function phonePrompt(a: Actor, d: Data): Promise<Screen> {
  await save(a, "ENTER_PHONE", d);
  const policy = privacyPolicyUrl();
  return {
    text: `Укажите номер телефона для связи.\n\n${CONSENT_NOTE}`,
    buttons: [...(policy ? [[{ type: "link", text: "Политика конфиденциальности", url: policy } as Button]] : []), ...nav(cb.bkBack("date"))],
  };
}

async function confirmStep(a: Actor, d: Data): Promise<Screen> {
  const offer = await loadOffer(d);
  if (!offer || !d.masterId || !d.date || d.minutes === undefined || !d.name || !d.phone) return restart(a);
  await save(a, "CONFIRM_BOOKING", d);
  const master = d.masterId === "any" ? "любой доступный" : ((await prisma.master.findUnique({ where: { id: d.masterId } }))?.name ?? "—");
  const title = d.rescheduleFrom ? "Проверьте перенос записи:" : "Проверьте запись:";
  const text = [
    title,
    "",
    `Услуга: ${offer.service.name}${offer.addon ? ` + ${offer.addon.name}` : ""}`,
    `Мастер: ${master}`,
    `Дата: ${formatDateRu(d.date)}`,
    `Время: ${minutesToHHmm(d.minutes)}`,
    `Стоимость: ${formatPrice(offer.priceRub, offer.priceFrom)}`,
    `Продолжительность: ${formatDuration(offer.durationMin)}`,
    `Имя: ${d.name}`,
    `Телефон: ${d.phone}`,
    "",
    "Всё верно?",
  ].join("\n");
  return {
    text,
    buttons: [[btn("✅ Подтвердить", cb.bkConfirm, "positive")], [btn("✏️ Изменить", cb.bkEdit), btn("❌ Отменить", cb.bkAbort, "negative")]],
  };
}

/** После выбора времени: если имя и телефон уже известны, просим только подтвердить */
async function afterTime(a: Actor, d: Data): Promise<Screen> {
  const client = await prisma.client.findUnique({ where: { userId: a.userId } });
  const known = { ...d, name: d.name ?? client?.name, phone: d.phone ?? client?.phone ?? undefined };
  if (known.name && known.phone) return confirmStep(a, known);
  if (known.name) return phonePrompt(a, known);
  await save(a, "ENTER_NAME", known);
  return { text: "Как вас зовут?", buttons: nav(cb.bkBack("date")) };
}

async function doConfirm(a: Actor): Promise<Screen> {
  const s = await getSession(a.userId);
  const d = s.data as Data;
  if (s.state !== "CONFIRM_BOOKING") return myList(a); // повторное нажатие / устаревшая кнопка
  if (!d.serviceId || !d.masterId || !d.date || d.minutes === undefined || !d.name || !d.phone) return restart(a);

  try {
    const booking = await createBooking({
      userId: a.userId,
      masterId: d.masterId,
      serviceId: d.serviceId,
      addonServiceId: d.addon && d.addon !== "0" ? d.addon : null,
      dateISO: d.date,
      minutes: d.minutes,
      name: d.name,
      phone: d.phone,
      rescheduleFromId: d.rescheduleFrom,
    });
    await prisma.user.update({ where: { id: a.userId }, data: { consentAt: new Date() } }).catch(() => undefined);
    await setSession(a.userId, "BOOKING_CREATED");
    logger.info("booking confirmed", { operation: "booking_confirm", bookingId: booking.id, userId: a.userId, phone: maskPhone(d.phone) });
    await notifyAdminsBooking(d.rescheduleFrom ? "rescheduled" : "new", booking.id);
    const addr = env().SALON_ADDRESS;
    return {
      text: `✅ ${d.rescheduleFrom ? "Запись перенесена" : "Вы записаны"}!\n\n${bookingCard(booking)}${addr ? `\n📍 ${addr}` : ""}\n\nМы напомним о визите заранее. До встречи!`,
      buttons: [[btn("📅 Моя запись", cb.myList)], ...mapLink().map((b) => [b]), ...nav()],
    };
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return timeStep(a, d, "К сожалению, это время только что заняли.\nПожалуйста, выберите другое время.");
    }
    if (e instanceof BookingValidationError) return restart(a, "Не получилось оформить запись.");
    logger.error("confirm failed", { operation: "booking_confirm", error: errorMessage(e) });
    return technicalProblem(); // ложное подтверждение исключено: запись создаётся только в БД-транзакции
  }
}

// ───────── Моя запись ─────────

async function myList(a: Actor): Promise<Screen> {
  const list = await listUpcoming(a.userId);
  await setSession(a.userId, "IDLE");
  if (!list.length) {
    return { text: "У вас пока нет предстоящих записей.", buttons: [[btn("💇 Записаться", cb.bkStart)], ...nav()] };
  }
  const first = list[0];
  if (first && list.length === 1) return myItem(a, first.id);
  return {
    text: `Ваша ближайшая запись:\n\n${first ? bookingCard(first) : ""}\n\nВсе записи:`,
    buttons: [...list.map((b) => [btn(`${formatDateRu(b.startsAt)}, ${formatTimeLocal(b.startsAt)} · ${b.service.name}`, cb.myItem(b.id))]), ...nav()],
  };
}

async function myItem(a: Actor, id: string): Promise<Screen> {
  const b = await findOwnBooking(a.userId, id);
  if (!b || !["NEW", "CONFIRMED"].includes(b.status)) return { text: "Эта запись уже неактуальна.", buttons: [[btn("📅 Моя запись", cb.myList)], ...nav()] };
  return {
    text: `Ваша запись:\n\n${bookingCard(b)}`,
    buttons: [[btn("🔄 Перенести", cb.myResched(b.id)), btn("❌ Отменить", cb.myCancelAsk(b.id), "negative")], ...(mapLink().length ? [mapLink()] : []), ...nav(cb.myList)],
  };
}

async function myResched(a: Actor, id: string): Promise<Screen> {
  const b = await findOwnBooking(a.userId, id);
  if (!b || !["NEW", "CONFIRMED"].includes(b.status) || b.startsAt.getTime() <= Date.now()) return myItem(a, id);
  const client = await prisma.client.findUnique({ where: { userId: a.userId } });
  const d: Data = {
    serviceId: b.serviceId,
    addon: b.addonServiceIds[0] ?? "0",
    masterId: b.masterId,
    name: client?.name,
    phone: client?.phone ?? undefined,
    rescheduleFrom: b.id,
  };
  return dateStep(a, d);
}

async function myCancelAsk(a: Actor, id: string): Promise<Screen> {
  const b = await findOwnBooking(a.userId, id);
  if (!b || !["NEW", "CONFIRMED"].includes(b.status)) return myItem(a, id);
  return {
    text: `Вы действительно хотите отменить запись на ${formatDateRu(b.startsAt)} в ${formatTimeLocal(b.startsAt)}?`,
    buttons: [[btn("Да, отменить", cb.myCancelYes(b.id), "negative"), btn("Нет", cb.myItem(b.id))]],
  };
}

async function myCancelYes(a: Actor, id: string): Promise<Screen> {
  const r = await cancelBooking(a.userId, id);
  if (r.result === "cancelled") {
    await notifyAdminsBooking("cancelled", r.booking.id);
    return { text: "Запись отменена.\n\nЕсли захотите записаться снова, я помогу выбрать новое время.", buttons: [[btn("💇 Записаться", cb.bkStart)], ...nav()] };
  }
  if (r.result === "past") return { text: "Эта запись уже началась, отменить её через бота нельзя.", buttons: nav(cb.myList) };
  return { text: "Эта запись уже отменена.", buttons: [[btn("💇 Записаться", cb.bkStart)], ...nav()] };
}

// ───────── публичные обработчики ─────────

export async function handleBookingAction(action: BookingAction, a: Actor): Promise<Screen> {
  const s = await getSession(a.userId);
  const d = s.data as Data;

  switch (action.kind) {
    case "bkStart":
      await prisma.analyticsEvent.create({ data: { userId: a.userId, type: "booking_started" } }).catch(() => undefined);
      return categoriesStep(a, {});
    case "bkCat":
      return servicesStep(a, action.id);
    case "bkSvc": {
      const svc = await prisma.service.findFirst({ where: { id: action.id, active: true, isAddon: false } });
      if (!svc) return categoriesStep(a, {});
      await prisma.analyticsEvent.create({ data: { userId: a.userId, type: "service_selected", data: { serviceId: svc.id } } }).catch(() => undefined);
      const addon = await prisma.service.findFirst({ where: { active: true, isAddon: true }, orderBy: { sortOrder: "asc" } });
      const next: Data = { serviceId: svc.id };
      if (!addon) return masterStep(a, next);
      await save(a, "OFFER_ADDON", next);
      return {
        text: `К услуге можно добавить: ${addon.name}\n\n+${formatPrice(addon.priceRub, addon.priceFrom)}\n+${formatDuration(addon.durationMin)}\n\nДобавить?`,
        buttons: [[btn("✨ Добавить", cb.bkAddon(addon.id)), btn("➡️ Нет, спасибо", cb.bkAddon("0"))], ...nav(cb.bkBack("svc"))],
      };
    }
    case "bkAddon":
      if (!d.serviceId) return restart(a);
      return masterStep(a, { serviceId: d.serviceId, addon: action.id });
    case "bkMaster": {
      if (!d.serviceId) return restart(a);
      if (action.id !== "any") {
        const ok = (await mastersOf(d.serviceId)).some((m) => m.id === action.id);
        if (!ok) return masterStep(a, d);
      }
      return dateStep(a, { ...d, masterId: action.id });
    }
    case "bkDate": {
      const today = nowLocal().toISODate() ?? "";
      if (!isValidDateISO(action.date) || action.date < today) return dateStep(a, d);
      return timeStep(a, { ...d, date: action.date });
    }
    case "bkTime": {
      const offer = await loadOffer(d);
      const ids = await masterIds(d);
      if (!offer || !ids.length || !d.date) return restart(a);
      const free = await getSlotsForMasters(ids, d.date, offer.durationMin, d.rescheduleFrom);
      if (!free.includes(action.minutes)) {
        return timeStep(a, d, "К сожалению, это время только что заняли.\nПожалуйста, выберите другое время.");
      }
      const next = { ...d, minutes: action.minutes };
      return d.rescheduleFrom ? confirmStep(a, next) : afterTime(a, next);
    }
    case "bkBack":
      switch (action.step) {
        case "cat":
          return categoriesStep(a, {});
        case "svc": {
          const svc = d.serviceId ? await prisma.service.findUnique({ where: { id: d.serviceId } }) : null;
          return svc ? servicesStep(a, svc.categoryId) : categoriesStep(a, {});
        }
        case "master":
          return masterStep(a, d, true);
        case "date":
          return d.masterId ? dateStep(a, d) : restart(a);
      }
      return restart(a);
    case "bkConfirm":
      return doConfirm(a);
    case "bkEdit":
      return d.rescheduleFrom ? myResched(a, d.rescheduleFrom) : categoriesStep(a, {});
    case "bkAbort":
      return restart(a, "Запись отменена, ничего не сохранено.");
    case "myList":
      return myList(a);
    case "myItem":
      return myItem(a, action.id);
    case "myResched":
      return myResched(a, action.id);
    case "myCancelAsk":
      return myCancelAsk(a, action.id);
    case "myCancelYes":
      return myCancelYes(a, action.id);
  }
}

/** Свободный текст в состояниях ENTER_NAME / ENTER_PHONE */
export async function handleBookingText(a: Actor, text: string): Promise<Screen | null> {
  const s = await getSession(a.userId);
  const d = s.data as Data;

  if (s.state === "ENTER_NAME") {
    const name = validateName(text);
    if (!name) return { text: "Пожалуйста, напишите имя буквами (от 2 до 50 символов).", buttons: nav(cb.bkBack("date")) };
    return phonePrompt(a, { ...d, name });
  }
  if (s.state === "ENTER_PHONE") {
    const phone = normalizePhone(text);
    if (!phone) return { text: "Не удалось распознать номер. Пример: +7 912 345-67-89", buttons: nav(cb.bkBack("date")) };
    return confirmStep(a, { ...d, phone });
  }
  return null;
}
