import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Admin } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logging/logger";
import { rateLimit } from "@/lib/security/rate-limit";
import { safeEqual } from "@/lib/security/compare";
import { can, type Permission } from "./permissions";
import { normalizeEmail } from "./password";
import { COOKIE_NAME, SESSION_TTL_SEC, signSession, verifySession } from "./session-token";

const BCRYPT_COST = 12;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);

let dummy: string | undefined;

export type LoginResult = { ok: true; admin: Admin } | { ok: false; reason: "invalid" | "rate" };

/**
 * Проверка логина. Ответ всегда обобщённый («неверные данные»), время ответа для несуществующего
 * пользователя выравнивается фиктивным bcrypt-сравнением; лимиты по IP и по email; блокировка после 5 ошибок.
 */
export async function authenticate(emailRaw: string, password: string, ip: string): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const byIp = await rateLimit(`login:ip:${ip}`, 20, 900);
  const byEmail = await rateLimit(`login:email:${email ?? "invalid"}`, 8, 900);
  if (!byIp.allowed || !byEmail.allowed) return { ok: false, reason: "rate" };

  const admin = email ? await prisma.admin.findUnique({ where: { email } }) : null;
  const now = new Date();

  if (!admin || !admin.active || password.length > 128) {
    dummy ??= await bcrypt.hash("timing-equalizer-password", BCRYPT_COST);
    await bcrypt.compare(password.slice(0, 128), dummy);
    logger.warn("admin login failed", { operation: "admin_login", status: "unknown_or_inactive" });
    return { ok: false, reason: "invalid" };
  }
  if (admin.lockedUntil && admin.lockedUntil > now) {
    logger.warn("admin login blocked (locked)", { operation: "admin_login", userId: admin.id });
    return { ok: false, reason: "rate" };
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    const fails = admin.failedLogins + 1;
    await prisma.admin.update({
      where: { id: admin.id },
      data: fails >= MAX_FAILS ? { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MS) } : { failedLogins: fails },
    });
    await prisma.auditLog.create({ data: { adminId: admin.id, action: "admin.login_failed", entityType: "Admin", entityId: admin.id } });
    logger.warn("admin login failed", { operation: "admin_login", userId: admin.id, status: "bad_password" });
    return { ok: false, reason: "invalid" };
  }

  await prisma.admin.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null } });
  await prisma.auditLog.create({ data: { adminId: admin.id, action: "admin.login", entityType: "Admin", entityId: admin.id } });
  return { ok: true, admin };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  // на Vercel x-forwarded-for выставляет платформа
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

export async function startSession(admin: Admin): Promise<void> {
  const token = await signSession(env().ADMIN_SESSION_SECRET, { sub: admin.id, ver: admin.tokenVersion, csrf: randomBytes(24).toString("hex") });
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export interface AdminContext {
  admin: Admin;
  csrf: string;
}

/**
 * Роль и активность берутся из БД при КАЖДОМ запросе, а не из cookie:
 * сменили роль, отключили пользователя или подняли tokenVersion — сессия перестаёт действовать сразу.
 */
export const getAdminContext = cache(async (): Promise<AdminContext | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  const claims = await verifySession(env().ADMIN_SESSION_SECRET, token);
  if (!claims) return null;
  const admin = await prisma.admin.findUnique({ where: { id: claims.sub } });
  if (!admin || !admin.active || admin.tokenVersion !== claims.ver) return null;
  return { admin, csrf: claims.csrf };
});

export async function requireAdmin(perm?: Permission): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/admin/login");
  if (perm && !can(ctx.admin.role, perm)) redirect("/admin?denied=1");
  return ctx;
}

/** Для server actions: сессия + право + CSRF-токен из формы. Любая неудача — редирект без подробностей. */
export async function authorizeAction(perm: Permission, formData: FormData): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) redirect("/admin/login");
  if (!can(ctx.admin.role, perm)) {
    logger.warn("admin action denied: role", { operation: "admin_action", userId: ctx.admin.id, status: perm });
    redirect("/admin?denied=1");
  }
  const sent = formData.get("_csrf");
  if (typeof sent !== "string" || !safeEqual(sent, ctx.csrf)) {
    logger.warn("admin action denied: csrf", { operation: "admin_action", userId: ctx.admin.id });
    redirect("/admin?denied=1");
  }
  return ctx;
}
