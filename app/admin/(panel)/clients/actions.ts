"use server";

import { revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/admin/auth";
import { anonymizeClient } from "@/lib/admin/clients";
import { audit, checked, done, enqueueSync, idField, text } from "@/lib/admin/forms";
import { prisma } from "@/lib/db/prisma";

export async function saveClientComment(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("clients", fd);
  const id = idField(fd, "id");
  if (!id) done("/admin/clients", "invalid");
  const back = `/admin/clients/${id}`;
  const r = await prisma.client.updateMany({ where: { id, anonymizedAt: null }, data: { comment: text(fd, "comment", 500) || null, lastSyncSource: "DB" } });
  if (r.count === 0) done(back, "notfound");
  await enqueueSync("client", id);
  await audit(admin.id, "client.comment", "Client", id);
  revalidatePath(back);
  done(back, "saved");
}

/** Удаление данных по запросу — только владелец (право «admins»), с обязательным подтверждением */
export async function deleteClientData(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("admins", fd);
  const id = idField(fd, "id");
  if (!id) done("/admin/clients", "invalid");
  const back = `/admin/clients/${id}`;
  if (!checked(fd, "confirm")) done(back, "confirm");
  const r = await anonymizeClient(id, admin.id);
  revalidatePath("/admin/clients");
  done(r === "done" ? "/admin/clients" : back, r === "done" ? "erased" : r === "not_found" ? "notfound" : r);
}
