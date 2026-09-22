"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { done, idField, intField, text } from "@/lib/admin/forms";
import { BookingValidationError, SlotTakenError } from "@/lib/booking/errors";
import { createBooking } from "@/lib/booking/service";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";
import { processDueNotifications } from "@/lib/notifications/sender";
import { isValidDateISO, nowLocal } from "@/lib/utils/time";
import { normalizePhone, validateName } from "@/lib/utils/validation";

const BASE = "/admin/calendar/new";

export async function createAdminBooking(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("bookings:write", fd);
  const moveId = idField(fd, "move");
  const serviceId = idField(fd, "service");
  const masterRaw = text(fd, "master", 40);
  const masterId = masterRaw === "any" ? "any" : idField(fd, "master");
  const date = text(fd, "date", 10);
  const minutes = intField(fd, "time", 0, 1439);
  const retry = new URLSearchParams({ ...(moveId ? { move: moveId } : {}), ...(serviceId ? { service: serviceId } : {}), ...(masterId ? { master: masterId } : {}), date }).toString();

  if (!serviceId || !masterId || !isValidDateISO(date) || date < nowLocal().toISODate()! || minutes === null) done(BASE, "invalid");

  try {
    let booking;
    if (moveId) {
      const old = await prisma.booking.findFirst({ where: { id: moveId, status: { in: ["NEW", "CONFIRMED"] } }, include: { client: true } });
      if (!old) done(BASE, "invalid");
      booking = await createBooking({
        clientId: old.clientId,
        masterId,
        serviceId: old.serviceId,
        addonServiceId: old.addonServiceIds[0] ?? null,
        dateISO: date,
        minutes,
        name: old.client.name,
        phone: old.client.phone ?? "",
        rescheduleFromId: old.id,
        source: "admin",
      });
    } else {
      const name = validateName(text(fd, "name", 60));
      const phone = normalizePhone(text(fd, "phone", 30));
      if (!name || !phone) done(`${BASE}?${retry}`, "badclient");
      booking = await createBooking({ userId: null, masterId, serviceId, dateISO: date, minutes, name, phone, source: "admin" });
    }
    await prisma.auditLog.create({ data: { adminId: admin.id, action: moveId ? "booking.move" : "booking.create", entityType: "Booking", entityId: booking.id } });
    // клиенту с MAX-аккаунтом сообщение уходит сразу (best-effort)
    await processDueNotifications({ bookingId: booking.id }).catch((e) => logger.warn("notify client failed", { error: errorMessage(e) }));
    revalidatePath("/admin/calendar");
    revalidatePath("/admin/bookings");
    done(`/admin/bookings/${booking.id}`, moveId ? "moved" : "created");
  } catch (e) {
    if (typeof e === "object" && e && "digest" in e) throw e; // redirect
    if (e instanceof SlotTakenError) done(`${BASE}?${retry}`, "taken");
    if (e instanceof BookingValidationError) done(`${BASE}?${retry}`, "invalid");
    logger.error("createAdminBooking failed", { operation: "admin_booking_create", userId: admin.id, error: errorMessage(e) });
    done(`${BASE}?${retry}`, "error");
  }
}
