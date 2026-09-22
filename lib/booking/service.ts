import { createHash } from "node:crypto";
import type { Booking, Master, Prisma, Service } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import { dayStartUtc, toUtc } from "@/lib/utils/time";
import { getDaySlotMinutes, LIVE_STATUSES } from "./availability";
import { BookingValidationError, SlotTakenError } from "./errors";

export type BookingWithNames = Booking & { master: Master; service: Service };

export interface CreateBookingInput {
  userId?: string | null; // MAX-пользователь (запись из бота)
  clientId?: string; // запись от администратора для существующего клиента
  masterId: string | "any";
  serviceId: string;
  addonServiceId?: string | null;
  dateISO: string;
  minutes: number;
  name: string;
  phone: string;
  rescheduleFromId?: string;
  source?: string;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/**
 * Создание (или перенос) записи.
 * Защита от двойной записи, три слоя:
 *  1) pg_advisory_xact_lock по мастеру — записи одного мастера обрабатываются строго по очереди;
 *  2) под замком слоты пересчитываются заново (график, перерывы, пересечения, «не в прошлом»);
 *  3) уникальный индекс Booking.slotKey — последняя линия обороны на уровне БД.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingWithNames> {
  const [service, addon] = await Promise.all([
    prisma.service.findFirst({ where: { id: input.serviceId, active: true, isAddon: false } }),
    input.addonServiceId ? prisma.service.findFirst({ where: { id: input.addonServiceId, active: true, isAddon: true } }) : null,
  ]);
  if (!service) throw new BookingValidationError("service");
  if (input.addonServiceId && !addon) throw new BookingValidationError("addon");

  const durationMin = service.durationMin + (addon?.durationMin ?? 0);
  const priceRub = service.priceRub + (addon?.priceRub ?? 0);
  const priceFrom = service.priceFrom || !!addon?.priceFrom;
  const startsAt = toUtc(input.dateISO, input.minutes);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);

  let candidates: string[];
  if (input.masterId === "any") {
    const masters = await prisma.master.findMany({ where: { active: true, services: { some: { serviceId: service.id } } }, select: { id: true } });
    const ids = masters.map((m) => m.id);
    const dayStart = dayStartUtc(input.dateISO);
    const load = await prisma.booking.groupBy({
      by: ["masterId"],
      where: { masterId: { in: ids }, status: { in: [...LIVE_STATUSES] }, startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
      _count: { _all: true },
    });
    const count = new Map(load.map((l) => [l.masterId, l._count._all]));
    candidates = ids.sort((a, b) => (count.get(a) ?? 0) - (count.get(b) ?? 0)); // наименее загруженный первым
  } else {
    const offers = await prisma.masterService.findUnique({ where: { masterId_serviceId: { masterId: input.masterId, serviceId: service.id } } });
    if (!offers) throw new BookingValidationError("master_service");
    candidates = [input.masterId];
  }

  for (const masterId of candidates) {
    const idempotencyKey = createHash("sha256")
      .update([input.clientId ?? input.userId ?? input.phone, masterId, startsAt.toISOString(), service.id, addon?.id ?? "", input.rescheduleFromId ?? ""].join("|"))
      .digest("hex");
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${masterId}))`;

          // Идемпотентность: повторное нажатие «Подтвердить» вернёт ту же запись
          const existing = await tx.booking.findUnique({ where: { idempotencyKey }, include: { master: true, service: true } });
          if (existing && (LIVE_STATUSES as readonly string[]).includes(existing.status)) return existing;

          const free = await getDaySlotMinutes(tx, masterId, input.dateISO, durationMin, input.rescheduleFromId);
          if (!free.includes(input.minutes)) throw new SlotTakenError();

          // Клиент: по id (админка) > по MAX-пользователю (бот) > по телефону (админка, новый клиент)
          let client = input.clientId
            ? await tx.client.findUnique({ where: { id: input.clientId } })
            : input.userId
              ? await tx.client.findUnique({ where: { userId: input.userId } })
              : await tx.client.findFirst({ where: { phone: input.phone, anonymizedAt: null } });
          if (client?.anonymizedAt) throw new BookingValidationError("client_anonymized");
          if (!client) client = await tx.client.create({ data: { userId: input.userId ?? undefined, name: input.name, phone: input.phone } });
          else if (input.userId && !input.clientId && (client.name !== input.name || client.phone !== input.phone)) {
            client = await tx.client.update({ where: { id: client.id }, data: { name: input.name, phone: input.phone } });
          }

          let old: Booking | null = null;
          if (input.rescheduleFromId) {
            old = await tx.booking.findFirst({ where: { id: input.rescheduleFromId, clientId: client.id, status: { in: [...LIVE_STATUSES] } } });
            if (!old) throw new BookingValidationError("reschedule_source");
          }

          // Старая запись освобождает слот ДО создания новой (иначе перенос на то же время упирался бы в уникальный slotKey);
          // при любой ошибке ниже вся транзакция откатывается.
          if (old) {
            await tx.booking.update({ where: { id: old.id }, data: { status: "RESCHEDULED", slotKey: null, idempotencyKey: null, syncStatus: "SYNC_PENDING" } });
          }

          const booking = await tx.booking.create({
            data: {
              clientId: client.id,
              masterId,
              serviceId: service.id,
              addonServiceIds: addon ? [addon.id] : [],
              startsAt,
              endsAt,
              durationMin,
              priceRub,
              priceFrom,
              status: "CONFIRMED",
              source: input.source ?? "max_bot",
              slotKey: `${masterId}|${startsAt.toISOString()}`,
              idempotencyKey,
              rescheduledFromId: old?.id,
              syncStatus: "SYNC_PENDING",
            },
            include: { master: true, service: true },
          });

          if (old) {
            await tx.notification.updateMany({ where: { bookingId: old.id, status: "PENDING" }, data: { status: "SKIPPED" } });
            await tx.syncQueue.create({ data: { entityType: "booking", entityId: old.id, action: "STATUS_CHANGE" } });
          }

          // Из бота ответ на подтверждение и есть уведомление (SENT). Запись от администратора:
          // клиенту с MAX-аккаунтом отправим сообщение (PENDING), без аккаунта — только телефон.
          const now = new Date();
          const fromAdmin = input.source === "admin";
          const notifications: Prisma.NotificationCreateManyInput[] = [];
          const confirmType = old ? "BOOKING_RESCHEDULED" : "BOOKING_CONFIRMATION";
          if (!fromAdmin) notifications.push({ bookingId: booking.id, userId: client.userId, type: confirmType, scheduledAt: now, sentAt: now, status: "SENT" });
          else if (client.userId) notifications.push({ bookingId: booking.id, userId: client.userId, type: confirmType, scheduledAt: now });
          if (client.userId) {
            for (const [type, hours] of [["REMINDER_24H", 24], ["REMINDER_2H", 2]] as const) {
              const at = new Date(startsAt.getTime() - hours * 3600_000);
              if (at.getTime() > now.getTime() + 60_000) notifications.push({ bookingId: booking.id, userId: client.userId, type, scheduledAt: at });
            }
          }
          await tx.notification.createMany({ data: notifications, skipDuplicates: true });
          await tx.syncQueue.create({ data: { entityType: "booking", entityId: booking.id, action: "UPSERT" } });
          await tx.syncQueue.create({ data: { entityType: "client", entityId: client.id, action: "UPSERT" } });
          await tx.analyticsEvent.create({ data: { userId: client.userId ?? undefined, type: old ? "booking_rescheduled" : "booking_created", data: { bookingId: booking.id } } });

          return booking;
        },
        { maxWait: 5_000, timeout: 15_000 },
      );
    } catch (e) {
      if (e instanceof SlotTakenError) continue; // пробуем следующего мастера (для «любой мастер»)
      if (isUniqueViolation(e)) {
        const again = await prisma.booking.findUnique({ where: { idempotencyKey }, include: { master: true, service: true } });
        if (again && (LIVE_STATUSES as readonly string[]).includes(again.status)) return again;
        continue; // слот занят по slotKey
      }
      logger.error("createBooking failed", { operation: "createBooking", userId: input.userId ?? undefined, error: errorMessage(e) });
      throw e;
    }
  }
  throw new SlotTakenError();
}

export type CancelResult =
  | { result: "cancelled"; booking: BookingWithNames }
  | { result: "already"; booking: BookingWithNames }
  | { result: "not_found" }
  | { result: "past"; booking: BookingWithNames };

export async function cancelBooking(userId: string, bookingId: string): Promise<CancelResult> {
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, client: { userId } }, include: { master: true, service: true } });
  if (!booking) return { result: "not_found" };
  if (!(LIVE_STATUSES as readonly string[]).includes(booking.status)) return { result: "already", booking };
  if (booking.startsAt.getTime() <= Date.now()) return { result: "past", booking };

  const done = await prisma.$transaction(async (tx) => {
    // updateMany с условием по статусу: конкурентные отмены выполнятся один раз
    const r = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: [...LIVE_STATUSES] } },
      data: { status: "CANCELLED", slotKey: null, idempotencyKey: null, syncStatus: "SYNC_PENDING" },
    });
    if (r.count === 0) return false;
    await tx.client.update({ where: { id: booking.clientId }, data: { cancelsCount: { increment: 1 } } });
    await tx.notification.updateMany({ where: { bookingId, status: "PENDING" }, data: { status: "SKIPPED" } });
    const now = new Date();
    await tx.notification.createMany({
      data: [{ bookingId, userId, type: "BOOKING_CANCELLED", scheduledAt: now, sentAt: now, status: "SENT" }],
      skipDuplicates: true,
    });
    await tx.syncQueue.create({ data: { entityType: "booking", entityId: bookingId, action: "STATUS_CHANGE" } });
    await tx.syncQueue.create({ data: { entityType: "client", entityId: booking.clientId, action: "UPSERT" } });
    await tx.analyticsEvent.create({ data: { userId, type: "booking_cancelled", data: { bookingId } } });
    return true;
  });
  return done ? { result: "cancelled", booking } : { result: "already", booking };
}

export function listUpcoming(userId: string, take = 5): Promise<BookingWithNames[]> {
  return prisma.booking.findMany({
    where: { client: { userId }, status: { in: [...LIVE_STATUSES] }, startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take,
    include: { master: true, service: true },
  });
}

export function findOwnBooking(userId: string, id: string): Promise<BookingWithNames | null> {
  return prisma.booking.findFirst({ where: { id, client: { userId } }, include: { master: true, service: true } });
}
