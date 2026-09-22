import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { LIVE_STATUSES } from "@/lib/booking/availability";
import { resolveDayWindow } from "@/lib/booking/slots";
import { formatPrice } from "@/lib/utils/format";
import { minutesToHHmm, nowLocal, toUtc } from "@/lib/utils/time";
import type { SheetDef, SheetsIO } from "./engine";
import { SHEET } from "./specs";

// Листы «только просмотр»: целиком пересобираются из БД, правки в них не читаются.
const STEP = 30;

async function scheduleRows(): Promise<string[][]> {
  const days = 14;
  const today = nowLocal().startOf("day");
  const firstISO = today.toISODate()!;
  const masters = await prisma.master.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { schedules: true } });
  const [exceptions, bookings] = await Promise.all([
    prisma.scheduleException.findMany({ where: { date: { gte: new Date(`${firstISO}T00:00:00Z`), lt: new Date(`${today.plus({ days }).toISODate()}T00:00:00Z`) } } }),
    prisma.booking.findMany({
      where: { status: { in: [...LIVE_STATUSES] }, startsAt: { gte: today.toUTC().toJSDate(), lt: today.plus({ days }).toUTC().toJSDate() } },
      select: { id: true, masterId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const rows: string[][] = [];
  for (const m of masters) {
    for (let i = 0; i < days; i++) {
      const d = today.plus({ days: i });
      const iso = d.toISODate()!;
      const ex = exceptions.filter((e) => e.masterId === m.id && e.date.toISOString().slice(0, 10) === iso);
      const window = resolveDayWindow(m.schedules.find((s) => s.weekday === d.weekday) ?? null, ex);
      if (!window) {
        rows.push([iso, m.name, "", ex.some((e) => e.type === "VACATION") ? "Отпуск" : "Выходной", ""]);
        continue;
      }
      for (let t = window.startMin; t < window.endMin; t += STEP) {
        const a = toUtc(iso, t);
        const b = toUtc(iso, t + STEP);
        const booking = bookings.find((x) => x.masterId === m.id && x.startsAt < b && x.endsAt > a);
        const inBreak = window.breaks.some((x) => t < x.endMin && t + STEP > x.startMin);
        rows.push([iso, m.name, minutesToHHmm(t), booking ? "Занято" : inBreak ? "Перерыв" : "Свободно", booking?.id ?? ""]);
      }
    }
  }
  return rows;
}

async function promoRows(): Promise<string[][]> {
  const list = await prisma.promotion.findMany({ orderBy: { startsAt: "desc" }, take: 200 });
  const f = (d: Date) => DateTime.fromJSDate(d, { zone: env().SALON_TIMEZONE }).toFormat("yyyy-MM-dd");
  return list.map((p) => [p.id, p.title, p.description, p.discountText ?? "", f(p.startsAt), f(p.endsAt), p.conditions ?? "", p.active ? "Да" : "Нет"]);
}

async function statsRows(): Promise<string[][]> {
  const today = nowLocal().startOf("day");
  const utc = (d: DateTime) => d.toUTC().toJSDate();
  const week = today.minus({ days: 6 });
  const live = { in: [...LIVE_STATUSES] };

  const [t, tm, revenueWeek, newClients, cancels, completed, top] = await Promise.all([
    prisma.booking.count({ where: { status: live, startsAt: { gte: utc(today), lt: utc(today.plus({ days: 1 })) } } }),
    prisma.booking.count({ where: { status: live, startsAt: { gte: utc(today.plus({ days: 1 })), lt: utc(today.plus({ days: 2 })) } } }),
    prisma.booking.aggregate({ _sum: { priceRub: true }, where: { status: "COMPLETED", startsAt: { gte: utc(week) } } }),
    prisma.client.count({ where: { createdAt: { gte: utc(week) } } }),
    prisma.booking.count({ where: { status: "CANCELLED", updatedAt: { gte: utc(week) } } }),
    prisma.booking.count({ where: { status: "COMPLETED", startsAt: { gte: utc(week) } } }),
    prisma.booking.groupBy({ by: ["serviceId"], where: { status: { in: ["CONFIRMED", "COMPLETED"] }, startsAt: { gte: utc(today.minus({ days: 30 })) } }, _count: { _all: true }, orderBy: { _count: { serviceId: "desc" } }, take: 5 }),
  ]);
  const names = await prisma.service.findMany({ where: { id: { in: top.map((x) => x.serviceId) } }, select: { id: true, name: true } });
  const name = new Map(names.map((n) => [n.id, n.name]));

  return [
    ["Записи сегодня (активные)", String(t)],
    ["Записи завтра (активные)", String(tm)],
    ["Выручка за 7 дней (завершённые)", formatPrice(revenueWeek._sum.priceRub ?? 0)],
    ["Новые клиенты за 7 дней", String(newClients)],
    ["Отмены за 7 дней", String(cancels)],
    ["Завершённые за 7 дней", String(completed)],
    ["", ""],
    ["Популярные услуги за 30 дней", "Записей"],
    ...top.map((x) => [name.get(x.serviceId) ?? "—", String(x._count._all)]),
  ];
}

function settingsRows(lastSyncISO: string): string[][] {
  const e = env();
  return [
    ["Салон", e.SALON_NAME],
    ["Телефон", e.SALON_PHONE],
    ["Адрес", e.SALON_ADDRESS],
    ["Часовой пояс", e.SALON_TIMEZONE],
    ["Последняя синхронизация (UTC)", lastSyncISO],
    ["", ""],
    ["Как пользоваться", "Записи, Клиенты, Услуги, Мастера: правьте только выделенные ниже поля. Расписание, Акции, Настройки, Статистика — только просмотр."],
    ["Записи", "Можно менять «Статус» и «Комментарий». Дату/время переносите в админ-панели или через бота."],
    ["Клиенты", "Можно менять «Комментарий»."],
    ["Услуги", "Можно менять название, описание, цену, «Цена от», продолжительность, активность (Да/Нет)."],
    ["Мастера", "Можно менять имя, телефон, специализацию, статус. График — в админ-панели."],
  ];
}

export const SNAPSHOT_DEFS: SheetDef[] = [
  { name: SHEET.schedule, headers: ["Дата", "Мастер", "Время", "Статус", "ID записи"], hashColumn: false },
  { name: SHEET.promos, headers: ["ID", "Название", "Описание", "Скидка", "Начало", "Окончание", "Условия", "Активность"], hashColumn: false },
  { name: SHEET.settings, headers: ["Параметр", "Значение"], hashColumn: false },
  { name: SHEET.stats, headers: ["Показатель", "Значение"], hashColumn: false },
];

export async function refreshSnapshots(io: SheetsIO, nowISO: string): Promise<void> {
  const [schedule, promos, stats] = await Promise.all([scheduleRows(), promoRows(), statsRows()]);
  await io.replace(SHEET.schedule, 5, schedule);
  await io.replace(SHEET.promos, 8, promos);
  await io.replace(SHEET.settings, 2, settingsRows(nowISO));
  await io.replace(SHEET.stats, 2, stats);
}
