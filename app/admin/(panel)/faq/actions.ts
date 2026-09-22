"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { audit, checked, done, idField, intField, text } from "@/lib/admin/forms";
import { prisma } from "@/lib/db/prisma";

const BACK = "/admin/faq";

export async function saveFaq(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("faq", fd);
  const id = idField(fd, "id");
  const question = text(fd, "question", 200);
  const answer = text(fd, "answer", 2000);
  if (!question || !answer) done(BACK, "invalid");
  const data = { question, answer, sortOrder: intField(fd, "sortOrder", 0, 999) ?? 0, active: id ? checked(fd, "active") : true };
  const f = id ? await prisma.fAQ.update({ where: { id }, data }) : await prisma.fAQ.create({ data });
  await audit(admin.id, id ? "faq.update" : "faq.create", "FAQ", f.id);
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function deleteFaq(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("faq", fd);
  const id = idField(fd, "id");
  if (!id) done(BACK, "invalid");
  await prisma.fAQ.deleteMany({ where: { id } });
  await audit(admin.id, "faq.delete", "FAQ", id);
  revalidatePath(BACK);
  done(BACK, "deleted");
}
