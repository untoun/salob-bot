import { prisma } from "@/lib/db/prisma";
import { DateTime } from "luxon";
import { env } from "@/lib/config/env";
import { minutesToHHmm } from "@/lib/utils/time";
import { applyBookingStatus } from "@/lib/booking/status";
import type { EditResult, EntitySpec } from "./engine";
import { parseIntStrict, parseYesNo, STATUS_RU, statusFromRu, WEEKDAY_RU, yesNo } from "./labels";

export const SHEET = {
  bookings: "Записи",
  clients: "Клиенты",
  masters: "Мастера",
  services: "Услуги",
  schedule: "Расписание",
  promos: "Акции",
  settings: "Настройки",
  stats: "Статистика",
} as const;

const local = (d: Date, fmt: string) => DateTime.fromJSDate(d, { zone: env().SALON_TIMEZONE }).toFormat(fmt);
const cut = (s: string, n: number) => s.trim().slice(0, n);

// ───────── Записи ─────────
export const bookingsSpec: EntitySpec = {
  entityType: "booking",
  sheet: SHEET.bookings,
  headers: [
    "ID", "Дата создания", "Дата визита", "Время", "Клиент", "Телефон", "MAX User ID", "Услуга", "Мастер",
    "Стоимость", "Продолжительность", "Статус", "Комментарий", "Источник", "Дата изменения",
  ],
  editable: [11, 12], // Статус, Комментарий
  async load(ids) {
    const list = await prisma.booking.findMany({
      where: { id: { in: ids } },
      include: { client: { include: { user: { select: { maxUserId: true } } } }, master: true, service: true },
    });
    const addonIds = [...new Set(list.flatMap((b) => b.addonServiceIds))];
    const addons = addonIds.length ? await prisma.service.findMany({ where: { id: { in: addonIds } }, select: { id: true, name: true } }) : [];
    const addonName = new Map(addons.map((a) => [a.id, a.name]));
    return list.map((b) => ({
      id: b.id,
      cells: [
        b.id,
        local(b.createdAt, "yyyy-MM-dd HH:mm"),
        local(b.startsAt, "yyyy-MM-dd"),
        local(b.startsAt, "HH:mm"),
        b.client.name,
        b.client.phone ?? "",
        b.client.user?.maxUserId.toString() ?? "",
        [b.service.name, ...b.addonServiceIds.map((x) => addonName.get(x) ?? "")].filter(Boolean).join(" + "),
        b.master.name,
        String(b.priceRub),
        String(b.durationMin),
        STATUS_RU[b.status],
        b.comment ?? "",
        b.source,
        local(b.updatedAt, "yyyy-MM-dd HH:mm"),
      ],
    }));
  },
  async loadRecentIds() {
    const since = new Date(Date.now() - 60 * 86_400_000);
    return (await prisma.booking.findMany({ where: { startsAt: { gte: since } }, select: { id: true } })).map((b) => b.id);
  },
  async applyEdit(id, [statusLabel = "", commentRaw = ""]): Promise<EditResult> {
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) return "unknown";
    const status = statusFromRu(statusLabel);
    if (!status) return "rejected";
    const comment = cut(commentRaw, 500);
    let changed = false;
    if (comment !== (booking.comment ?? "")) {
      await prisma.booking.update({ where: { id }, data: { comment: comment || null, lastSyncSource: "SHEETS", lastSyncedAt: new Date() } });
      changed = true;
    }
    if (status !== booking.status) {
      const r = await applyBookingStatus(id, status, "SHEETS");
      if (r === "rejected") return "rejected";
      if (r === "applied") changed = true;
    }
    return changed ? "applied" : "noop";
  },
};

// ───────── Клиенты ─────────
export const clientsSpec: EntitySpec = {
  entityType: "client",
  sheet: SHEET.clients,
  headers: ["ID", "Имя", "Телефон", "MAX User ID", "Дата первой записи", "Дата последнего посещения", "Количество посещений", "Количество отмен", "Комментарий"],
  editable: [8],
  async load(ids) {
    const list = await prisma.client.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { maxUserId: true } }, bookings: { orderBy: { createdAt: "asc" }, take: 1, select: { createdAt: true } } },
    });
    return list.map((c) => ({
      id: c.id,
      // удалённые по запросу клиенты: строка остаётся, персональные данные стираются
      cells: c.anonymizedAt ? [c.id, "[удалён]", "", "", "", "", "", "", ""] : [
        c.id,
        c.name,
        c.phone ?? "",
        c.user?.maxUserId.toString() ?? "",
        c.bookings[0] ? local(c.bookings[0].createdAt, "yyyy-MM-dd") : "",
        c.lastVisitAt ? local(c.lastVisitAt, "yyyy-MM-dd") : "",
        String(c.visitsCount),
        String(c.cancelsCount),
        c.comment ?? "",
      ],
    }));
  },
  async loadRecentIds() {
    return (await prisma.client.findMany({ where: { anonymizedAt: null }, select: { id: true } })).map((c) => c.id);
  },
  async applyEdit(id, [commentRaw = ""]) {
    const c = await prisma.client.findUnique({ where: { id } });
    if (!c) return "unknown";
    const comment = cut(commentRaw, 500);
    if (comment === (c.comment ?? "")) return "noop";
    await prisma.client.update({ where: { id }, data: { comment: comment || null, lastSyncSource: "SHEETS", lastSyncedAt: new Date() } });
    return "applied";
  },
};

// ───────── Услуги ─────────
export const servicesSpec: EntitySpec = {
  entityType: "service",
  sheet: SHEET.services,
  headers: ["ID", "Название", "Категория", "Описание", "Цена", "Цена от", "Продолжительность", "Активность"],
  editable: [1, 3, 4, 5, 6, 7],
  async load(ids) {
    const list = await prisma.service.findMany({ where: { id: { in: ids } }, include: { category: true } });
    return list.map((s) => ({
      id: s.id,
      cells: [s.id, s.name, s.category.name, s.description ?? "", String(s.priceRub), yesNo(s.priceFrom), String(s.durationMin), yesNo(s.active)],
    }));
  },
  async loadRecentIds() {
    return (await prisma.service.findMany({ select: { id: true } })).map((s) => s.id);
  },
  async applyEdit(id, [name = "", description = "", price = "", from = "", duration = "", active = ""]) {
    const s = await prisma.service.findUnique({ where: { id } });
    if (!s) return "unknown";
    const priceRub = parseIntStrict(price);
    const durationMin = parseIntStrict(duration);
    const priceFrom = parseYesNo(from);
    const isActive = parseYesNo(active);
    const n = cut(name, 100);
    // любая некорректная ячейка отклоняет всю правку; строка вернётся к значениям из БД
    if (!n || priceRub === null || priceRub > 1_000_000 || durationMin === null || durationMin < 5 || durationMin > 720 || priceFrom === null || isActive === null) {
      return "rejected";
    }
    const desc = cut(description, 1000) || null;
    const same = n === s.name && desc === s.description && priceRub === s.priceRub && durationMin === s.durationMin && priceFrom === s.priceFrom && isActive === s.active;
    if (same) return "noop";
    await prisma.service.update({ where: { id }, data: { name: n, description: desc, priceRub, durationMin, priceFrom, active: isActive } });
    await prisma.auditLog.create({ data: { action: "service.sheet_edit", entityType: "Service", entityId: id } });
    return "applied";
  },
};

// ───────── Мастера ─────────
export const mastersSpec: EntitySpec = {
  entityType: "master",
  sheet: SHEET.masters,
  headers: ["ID", "Имя", "Телефон", "Специализация", "Рабочие дни", "Начало работы", "Конец работы", "Статус"],
  editable: [1, 2, 3, 7],
  async load(ids) {
    const list = await prisma.master.findMany({ where: { id: { in: ids } }, include: { schedules: { orderBy: { weekday: "asc" } } } });
    return list.map((m) => {
      const starts = m.schedules.map((s) => s.startMin);
      const ends = m.schedules.map((s) => s.endMin);
      return {
        id: m.id,
        cells: [
          m.id,
          m.name,
          m.phone ?? "",
          m.specialization ?? "",
          m.schedules.map((s) => WEEKDAY_RU[s.weekday]).join(", "), // только чтение: график правится в админ-панели
          starts.length ? minutesToHHmm(Math.min(...starts)) : "",
          ends.length ? minutesToHHmm(Math.max(...ends)) : "",
          m.active ? "Активен" : "Не активен",
        ],
      };
    });
  },
  async loadRecentIds() {
    return (await prisma.master.findMany({ select: { id: true } })).map((m) => m.id);
  },
  async applyEdit(id, [name = "", phone = "", specialization = "", status = ""]) {
    const m = await prisma.master.findUnique({ where: { id } });
    if (!m) return "unknown";
    const n = cut(name, 100);
    const st = status.trim().toLowerCase();
    if (!n || !["активен", "не активен"].includes(st)) return "rejected";
    const data = { name: n, phone: cut(phone, 30) || null, specialization: cut(specialization, 100) || null, active: st === "активен" };
    const same = data.name === m.name && data.phone === m.phone && data.specialization === m.specialization && data.active === m.active;
    if (same) return "noop";
    await prisma.master.update({ where: { id }, data });
    await prisma.auditLog.create({ data: { action: "master.sheet_edit", entityType: "Master", entityId: id } });
    return "applied";
  },
};

export const ENTITY_SPECS: EntitySpec[] = [bookingsSpec, clientsSpec, servicesSpec, mastersSpec];
