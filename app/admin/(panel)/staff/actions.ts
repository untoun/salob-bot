"use server";

import type { AdminRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { authorizeAction, hashPassword } from "@/lib/admin/auth";
import { audit, checked, done, idField, text } from "@/lib/admin/forms";
import { normalizeEmail, validatePassword } from "@/lib/admin/password";
import { checkStaffChange } from "@/lib/admin/staff-rules";
import { prisma } from "@/lib/db/prisma";

const BACK = "/admin/staff";
const ROLES: AdminRole[] = ["SUPER_ADMIN", "ADMIN", "MASTER"];
const role = (v: FormDataEntryValue | null) => ROLES.find((r) => r === v);

function maxId(fd: FormData): bigint | null {
  const v = text(fd, "maxUserId", 15);
  return /^\d{1,15}$/.test(v) ? BigInt(v) : null;
}

async function masterLink(fd: FormData, r: AdminRole): Promise<string | null | "bad"> {
  if (r !== "MASTER") return null;
  const id = idField(fd, "masterId");
  return id && (await prisma.master.findUnique({ where: { id } })) ? id : "bad";
}

export async function createStaff(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("admins", fd);
  const email = normalizeEmail(text(fd, "email", 254));
  const r = role(fd.get("role"));
  const password = String(fd.get("password") ?? "");
  if (!email || !r) done(BACK, "invalid");
  const problem = validatePassword(password);
  if (problem) done(BACK, "weak");
  const link = await masterLink(fd, r);
  if (link === "bad") done(BACK, "nomaster");

  if (await prisma.admin.findUnique({ where: { email } })) done(BACK, "exists");
  const created = await prisma.admin.create({ data: { email, role: r, masterId: link, maxUserId: maxId(fd), passwordHash: await hashPassword(password) } });
  await audit(admin.id, "staff.create", "Admin", created.id, { role: r });
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function updateStaff(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("admins", fd);
  const id = idField(fd, "id");
  const r = role(fd.get("role"));
  if (!id || !r) done(BACK, "invalid");
  const target = await prisma.admin.findUnique({ where: { id } });
  if (!target) done(BACK, "invalid");

  const active = checked(fd, "active");
  const supers = await prisma.admin.count({ where: { role: "SUPER_ADMIN", active: true } });
  const blocked = checkStaffChange({ actorId: admin.id, targetId: id, targetRole: target.role, targetActive: target.active, newRole: r, newActive: active, activeSuperAdmins: supers });
  if (blocked) done(BACK, blocked);
  const link = await masterLink(fd, r);
  if (link === "bad") done(BACK, "nomaster");

  const sensitive = r !== target.role || active !== target.active;
  await prisma.admin.update({
    where: { id },
    data: { role: r, active, masterId: link, maxUserId: maxId(fd), ...(sensitive ? { tokenVersion: { increment: 1 } } : {}) },
  });
  await audit(admin.id, "staff.update", "Admin", id, { role: r, active });
  revalidatePath(BACK);
  done(BACK, "saved");
}

export async function resetPassword(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("admins", fd);
  const id = idField(fd, "id");
  const password = String(fd.get("password") ?? "");
  if (!id) done(BACK, "invalid");
  if (validatePassword(password)) done(BACK, "weak");
  await prisma.admin.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
  });
  await audit(admin.id, "staff.reset_password", "Admin", id); // сам пароль нигде не сохраняется и не логируется
  revalidatePath(BACK);
  done(BACK, "pwd");
}

export async function revokeSessions(fd: FormData): Promise<void> {
  const { admin } = await authorizeAction("admins", fd);
  const id = idField(fd, "id");
  if (!id) done(BACK, "invalid");
  await prisma.admin.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
  await audit(admin.id, "staff.revoke_sessions", "Admin", id);
  revalidatePath(BACK);
  done(BACK, "revoked");
}
