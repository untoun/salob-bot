/**
 * Интеграционные тесты на реальной PostgreSQL (отдельная ветка Neon / локальная БД).
 * Запуск: TEST_DATABASE_URL=postgresql://... npm test
 * Без TEST_DATABASE_URL тесты пропускаются. НЕ указывайте боевую БД: тест создаёт и удаляет свои записи.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("booking service (integration)", () => {
  let prisma: typeof import("@/lib/db/prisma").prisma;
  let svc: typeof import("@/lib/booking/service");
  let errors: typeof import("@/lib/booking/errors");
  const ids: { users: string[]; masterId: string; serviceId: string; catId: string } = { users: [], masterId: "", serviceId: "", catId: "" };
  let dateISO = "";
  const extraClients: string[] = [];
  let adminId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DIRECT_URL = url;
    process.env.MAX_WEBHOOK_SECRET = "test_secret_1";
    process.env.CRON_SECRET = "c".repeat(16);
    process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
    process.env.SALON_TIMEZONE = "Asia/Yekaterinburg";
    ({ prisma } = await import("@/lib/db/prisma"));
    svc = await import("@/lib/booking/service");
    errors = await import("@/lib/booking/errors");

    // ближайший понедельник не раньше чем через 3 дня
    let d = DateTime.now().setZone("Asia/Yekaterinburg").plus({ days: 3 }).startOf("day");
    while (d.weekday !== 1) d = d.plus({ days: 1 });
    dateISO = d.toISODate()!;

    const cat = await prisma.serviceCategory.create({ data: { name: "TEST cat" } });
    const service = await prisma.service.create({ data: { categoryId: cat.id, name: "TEST cut", priceRub: 1000, durationMin: 60 } });
    const master = await prisma.master.create({ data: { name: "TEST master" } });
    await prisma.masterService.create({ data: { masterId: master.id, serviceId: service.id } });
    await prisma.schedule.create({ data: { masterId: master.id, weekday: 1, startMin: 9 * 60, endMin: 18 * 60, breakStartMin: 13 * 60, breakEndMin: 14 * 60 } });
    Object.assign(ids, { masterId: master.id, serviceId: service.id, catId: cat.id });
    for (let i = 0; i < 3; i++) {
      const u = await prisma.user.create({ data: { maxUserId: BigInt(9_000_000_000 + Math.floor(Math.random() * 1e9)) } });
      ids.users.push(u.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.notification.deleteMany({ where: { booking: { masterId: ids.masterId } } });
    await prisma.syncQueue.deleteMany({});
    await prisma.booking.updateMany({ where: { masterId: ids.masterId }, data: { rescheduledFromId: null } });
    await prisma.booking.deleteMany({ where: { masterId: ids.masterId } });
    await prisma.client.deleteMany({ where: { OR: [{ userId: { in: ids.users } }, { id: { in: extraClients } }] } });
    await prisma.auditLog.deleteMany({ where: { adminId } });
    await prisma.admin.deleteMany({ where: { id: adminId } });
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: ids.users } } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.schedule.deleteMany({ where: { masterId: ids.masterId } });
    await prisma.masterService.deleteMany({ where: { masterId: ids.masterId } });
    await prisma.master.delete({ where: { id: ids.masterId } });
    await prisma.service.delete({ where: { id: ids.serviceId } });
    await prisma.serviceCategory.delete({ where: { id: ids.catId } });
    await prisma.$disconnect();
  });

  const input = (userIdx: number, minutes: number) => ({
    userId: ids.users[userIdx]!,
    masterId: ids.masterId,
    serviceId: ids.serviceId,
    dateISO,
    minutes,
    name: "Тест",
    phone: "+79123456789",
  });

  it("two users booking the same slot concurrently: exactly one wins", async () => {
    const results = await Promise.allSettled([svc.createBooking(input(0, 10 * 60)), svc.createBooking(input(1, 10 * 60))]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toBeInstanceOf(errors.SlotTakenError);
  });

  it("overlapping (not identical) time is rejected too", async () => {
    await expect(svc.createBooking(input(2, 10 * 60 + 30))).rejects.toBeInstanceOf(errors.SlotTakenError);
  });

  it("break time and out-of-hours are rejected", async () => {
    await expect(svc.createBooking(input(2, 13 * 60))).rejects.toBeInstanceOf(errors.SlotTakenError);
    await expect(svc.createBooking(input(2, 7 * 60))).rejects.toBeInstanceOf(errors.SlotTakenError);
  });

  it("repeated confirm by the same user is idempotent", async () => {
    const a = await svc.createBooking(input(2, 15 * 60));
    const b = await svc.createBooking(input(2, 15 * 60));
    expect(b.id).toBe(a.id);
    expect(await prisma.booking.count({ where: { masterId: ids.masterId, startsAt: a.startsAt } })).toBe(1);
  });

  it("cancel frees the slot and stops reminders; second cancel is harmless", async () => {
    const b = await svc.createBooking(input(0, 16 * 60));
    const r1 = await svc.cancelBooking(ids.users[0]!, b.id);
    expect(r1.result).toBe("cancelled");
    expect((await svc.cancelBooking(ids.users[0]!, b.id)).result).toBe("already");
    const pending = await prisma.notification.count({ where: { bookingId: b.id, status: "PENDING" } });
    expect(pending).toBe(0);
    // слот снова доступен другому клиенту
    const again = await svc.createBooking(input(1, 16 * 60));
    expect(again.status).toBe("CONFIRMED");
  });

  it("reschedule marks old booking RESCHEDULED and books the new slot", async () => {
    const source = await svc.createBooking(input(1, 17 * 60)); // 17:00–18:00, последний слот дня
    const moved = await svc.createBooking({ ...input(1, 9 * 60), rescheduleFromId: source.id });
    expect(moved.rescheduledFromId).toBe(source.id);
    const oldNow = await prisma.booking.findUnique({ where: { id: source.id } });
    expect(oldNow?.status).toBe("RESCHEDULED");
    expect(oldNow?.slotKey).toBeNull();
  });

  it("admin-created booking (no MAX user) reuses the client by phone and creates no reminders", async () => {
    const base = { userId: null, masterId: ids.masterId, serviceId: ids.serviceId, dateISO, name: "Звонок", phone: "+79990001122", source: "admin" };
    const b1 = await svc.createBooking({ ...base, minutes: 11 * 60 });
    const b2 = await svc.createBooking({ ...base, minutes: 12 * 60 });
    extraClients.push(b1.clientId);
    expect(b2.clientId).toBe(b1.clientId);
    expect(await prisma.notification.count({ where: { bookingId: { in: [b1.id, b2.id] } } })).toBe(0);
  });

  it("client data erasure: refused with future bookings, then anonymizes client and detaches MAX profile", async () => {
    const { anonymizeClient } = await import("@/lib/admin/clients");
    const { applyBookingStatus } = await import("@/lib/booking/status");
    const admin = await prisma.admin.create({ data: { email: `test-${Date.now()}@example.test`, passwordHash: "x", role: "SUPER_ADMIN" } });
    adminId = admin.id;
    // у пользователя №2 есть живая запись на 15:00 (создана в тесте идемпотентности)
    const target = (await prisma.booking.findFirst({ where: { masterId: ids.masterId, client: { userId: ids.users[2]! }, status: "CONFIRMED" } }))!;
    const clientId = target.clientId;
    expect(await anonymizeClient(clientId, adminId)).toBe("has_future");
    const live = await prisma.booking.findMany({ where: { clientId, status: { in: ["NEW", "CONFIRMED"] } } });
    for (const x of live) await applyBookingStatus(x.id, "CANCELLED", "DB", adminId);
    expect(await anonymizeClient(clientId, adminId)).toBe("done");
    const c = await prisma.client.findUnique({ where: { id: clientId } });
    expect(c?.name).toBe("[удалён]");
    expect(c?.phone).toBeNull();
    expect(c?.userId).toBeNull();
    expect(await prisma.user.findUnique({ where: { id: ids.users[2]! } })).toBeNull();
    expect(await anonymizeClient(clientId, adminId)).toBe("already");
    extraClients.push(clientId);
  });
});
