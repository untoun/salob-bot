"use server";

import type { BookingStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, enqueueSync, text } from "@/lib/admin/forms";
import { prisma } from "@/lib/db/prisma";
import { safeBackPath } from "@/lib/admin/bookings-query";
import { applyBookingStatus } from "@/lib/booking/status";
import { errorMessage, logger } from "@/lib/logging/logger";
import { processDueNotifications } from "@/lib/notifications/sender";

const ALLOWED: BookingStatus[] = ["CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const ID = /^[A-Za-z0-9_-]{8,40}$/;

export async function changeBookingStatus(formData: FormData): Promise<void> {
  const { admin } = await authorizeAction("bookings:write", formData);
  const back = safeBackPath(formData.get("back"));
  const sep = back.includes("?") ? "&" : "?";

  const id = formData.get("id");
  const status = ALLOWED.find((s) => s === formData.get("status"));
  if (typeof id !== "string" || !ID.test(id) || !status) redirect(`${back}${sep}msg=bad`);

  let msg = "ok";
  try {
    const result = await applyBookingStatus(id, status, "DB", admin.id);
    if (result === "rejected") msg = "rejected";
    else if (result === "unknown") msg = "missing";
    else if (result === "applied" && status === "CANCELLED") {
      // клиент получает уведомление об отмене сразу, не дожидаясь cron
      await processDueNotifications({ bookingId: id }).catch((e) => logger.warn("notify failed", { error: errorMessage(e) }));
    }
  } catch (e) {
    logger.error("change status failed", { operation: "admin_booking_status", userId: admin.id, error: errorMessage(e) });
    msg = "error";
  }
  revalidatePath("/admin/bookings");
  redirect(`${back}${sep}msg=${msg}`);
}

export async function saveBookingComment(formData: FormData): Promise<void> {
  const { admin } = await authorizeAction("bookings:write", formData);
  const back = safeBackPath(formData.get("back"));
  const id = formData.get("id");
  if (typeof id !== "string" || !ID.test(id)) redirect(`${back}?msg=bad`);
  const r = await prisma.booking.updateMany({
    where: { id },
    data: { comment: text(formData, "comment", 500) || null, lastSyncSource: "DB", syncStatus: "SYNC_PENDING" },
  });
  if (r.count === 0) redirect(`${back}?msg=missing`);
  await enqueueSync("booking", id);
  await audit(admin.id, "booking.comment", "Booking", id);
  revalidatePath(back);
  redirect(`${back}?msg=ok`);
}
