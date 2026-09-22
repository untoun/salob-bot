"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, checked, done, enqueueSync, httpsUrl, idField, intField, text } from "@/lib/admin/forms";
import { prisma } from "@/lib/db/prisma";
import { errorMessage, logger } from "@/lib/logging/logger";

const BACK = "/admin/masters";

export async function saveMaster(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("masters", fd);
  const id = idField(fd, "id");
  const name = text(fd, "name", 100);
  if (!name) done(BACK, "invalid");

  const photoRaw = text(fd, "photoUrl", 500);
  const photoUrl = httpsUrl(photoRaw);
  if (photoRaw && !photoUrl) done(BACK, "invalid"); // только https-ссылки на внешнее хранилище/CDN
  const ratingRaw = text(fd, "rating", 4).replace(",", ".");
  const rating = ratingRaw ? Number(ratingRaw) : null;
  if (rating !== null && !(rating >= 0 && rating <= 5)) done(BACK, "invalid");

  const requested = fd.getAll("services").filter((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(v));
  const data = {
    name,
    phone: text(fd, "phone", 30) || null,
    specialization: text(fd, "specialization", 100) || null,
    experienceYears: intField(fd, "experienceYears", 0, 80),
    bio: text(fd, "bio", 1000) || null,
    photoUrl,
    rating,
    active: id ? checked(fd, "active") : true,
  };
  try {
    const valid = await prisma.service.findMany({ where: { id: { in: requested } }, select: { id: true } });
    const master = await prisma.$transaction(async (tx) => {
      const m = id ? await tx.master.update({ where: { id }, data }) : await tx.master.create({ data });
      await tx.masterService.deleteMany({ where: { masterId: m.id } });
      await tx.masterService.createMany({ data: valid.map((s) => ({ masterId: m.id, serviceId: s.id })) });
      return m;
    });
    await enqueueSync("master", master.id);
    await audit(admin.id, id ? "master.update" : "master.create", "Master", master.id);
  } catch (e) {
    logger.error("saveMaster failed", { operation: "admin_master", error: errorMessage(e) });
    done(BACK, "error");
  }
  revalidatePath(BACK);
  done(BACK, "saved");
}
