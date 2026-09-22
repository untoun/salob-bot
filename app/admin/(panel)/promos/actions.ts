"use server";

import { DateTime } from "luxon";
import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, checked, done, idField, text } from "@/lib/admin/forms";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { isValidDateISO } from "@/lib/utils/time";

const BACK = "/admin/promos";

export async function savePromo(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("promos", fd);
  const id = idField(fd, "id");
  const title = text(fd, "title", 100);
  const description = text(fd, "description", 1000);
  const from = text(fd, "startsOn", 10);
  const to = text(fd, "endsOn", 10);
  if (!title || !description || !isValidDateISO(from) || !isValidDateISO(to) || to < from) done(BACK, "invalid");

  const zone = env().SALON_TIMEZONE;
  const data = {
    title,
    description,
    discountText: text(fd, "discountText", 40) || null,
    conditions: text(fd, "conditions", 500) || null,
    startsAt: DateTime.fromISO(from, { zone }).startOf("day").toUTC().toJSDate(),
    endsAt: DateTime.fromISO(to, { zone }).endOf("day").toUTC().toJSDate(), // включительно
    active: id ? checked(fd, "active") : true,
  };
  const p = id ? await prisma.promotion.update({ where: { id }, data }) : await prisma.promotion.create({ data });
  await audit(admin.id, id ? "promo.update" : "promo.create", "Promotion", p.id);
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function deletePromo(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("promos", fd);
  const id = idField(fd, "id");
  if (!id) done(BACK, "invalid");
  await prisma.promotion.deleteMany({ where: { id } });
  await audit(admin.id, "promo.delete", "Promotion", id);
  revalidatePath(BACK);
  done(BACK, "deleted");
}
