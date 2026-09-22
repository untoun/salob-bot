"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, checked, done, idField, text } from "@/lib/admin/forms";
import { validateDay, validateException, type DayRow } from "@/lib/admin/schedule-form";
import { LIVE_STATUSES } from "@/lib/booking/availability";
import { prisma } from "@/lib/db/prisma";
import { dayStartUtc, isValidDateISO, nowLocal } from "@/lib/utils/time";

const BACK = "/admin/schedule";

export async function saveWeek(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("schedule:write", fd);
  const masterId = idField(fd, "masterId");
  if (!masterId || !(await prisma.master.findUnique({ where: { id: masterId } }))) done(BACK, "invalid");

  const rows: DayRow[] = [];
  for (let d = 1; d <= 7; d++) {
    const r = validateDay({
      weekday: d,
      enabled: checked(fd, `d${d}_on`),
      start: text(fd, `d${d}_start`, 5),
      end: text(fd, `d${d}_end`, 5),
      breakStart: text(fd, `d${d}_bs`, 5),
      breakEnd: text(fd, `d${d}_be`, 5),
    });
    if (!r.ok) done(BACK, `bad_${r.error}`);
    if (r.row) rows.push(r.row);
  }
  await prisma.$transaction([
    prisma.schedule.deleteMany({ where: { masterId } }),
    prisma.schedule.createMany({ data: rows.map((r) => ({ ...r, masterId })) }),
  ]);
  await audit(admin.id, "schedule.week", "Master", masterId);
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function addException(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("schedule:write", fd);
  const masterId = idField(fd, "masterId");
  const date = text(fd, "date", 10);
  const type = text(fd, "type", 20);
  const v = validateException(type, text(fd, "start", 5), text(fd, "end", 5));
  if (!masterId || !isValidDateISO(date) || !v.ok) done(BACK, "invalid");
  if (date < nowLocal().toISODate()!) done(BACK, "past");
  if (!(await prisma.master.findUnique({ where: { id: masterId } }))) done(BACK, "invalid");

  await prisma.scheduleException.create({
    data: { masterId, date: new Date(`${date}T00:00:00.000Z`), type: type as "DAY_OFF", startMin: v.startMin, endMin: v.endMin, note: text(fd, "note", 200) || null },
  });
  await audit(admin.id, "schedule.exception_add", "Master", masterId, { date, type });

  // Предупреждаем, если на закрытую дату уже есть записи: их нужно перенести вручную
  let affected = 0;
  if (type === "DAY_OFF" || type === "VACATION") {
    const start = dayStartUtc(date);
    affected = await prisma.booking.count({
      where: { masterId, status: { in: [...LIVE_STATUSES] }, startsAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } },
    });
  }
  revalidatePath(BACK);
  done(BACK, affected > 0 ? `conflict_${Math.min(affected, 99)}` : "saved");
}

export async function deleteException(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("schedule:write", fd);
  const id = idField(fd, "id");
  if (!id) done(BACK, "invalid");
  await prisma.scheduleException.deleteMany({ where: { id } });
  await audit(admin.id, "schedule.exception_delete", "ScheduleException", id);
  revalidatePath(BACK);
  done(BACK, "deleted");
}
