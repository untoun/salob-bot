"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, checked, done, enqueueSync, idField, intField, text } from "@/lib/admin/forms";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";

const BACK = "/admin/services";

export async function saveCategory(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("services", fd);
  const id = idField(fd, "id");
  const name = text(fd, "name", 60);
  const sortOrder = intField(fd, "sortOrder", 0, 999) ?? 0;
  if (!name) done(BACK, "invalid");
  try {
    const cat = id
      ? await prisma.serviceCategory.update({ where: { id }, data: { name, sortOrder, active: checked(fd, "active") } })
      : await prisma.serviceCategory.create({ data: { name, sortOrder } });
    await audit(admin.id, id ? "category.update" : "category.create", "ServiceCategory", cat.id);
  } catch (e) {
    logger.error("saveCategory failed", { operation: "admin_category", error: errorMessage(e) });
    done(BACK, "error");
  }
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function saveService(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("services", fd);
  const id = idField(fd, "id");
  const categoryId = idField(fd, "categoryId");
  const name = text(fd, "name", 100);
  const priceRub = intField(fd, "priceRub", 0, 1_000_000);
  const durationMin = intField(fd, "durationMin", 5, 720);
  if (!categoryId || !name || priceRub === null || durationMin === null) done(BACK, "invalid");
  const data = {
    categoryId,
    name,
    description: text(fd, "description", 1000) || null,
    priceRub,
    priceFrom: checked(fd, "priceFrom"),
    durationMin,
    isAddon: checked(fd, "isAddon"),
    active: id ? checked(fd, "active") : true,
    sortOrder: intField(fd, "sortOrder", 0, 999) ?? 0,
  };
  try {
    if (!(await prisma.serviceCategory.findUnique({ where: { id: categoryId } }))) done(BACK, "invalid");
    const s = id ? await prisma.service.update({ where: { id }, data }) : await prisma.service.create({ data });
    await enqueueSync("service", s.id);
    await audit(admin.id, id ? "service.update" : "service.create", "Service", s.id);
  } catch (e) {
    if (typeof e === "object" && e && "digest" in e) throw e; // redirect из done()
    logger.error("saveService failed", { operation: "admin_service", error: errorMessage(e) });
    done(BACK, "error");
  }
  revalidatePath(BACK);
  done(BACK, "saved");
}
