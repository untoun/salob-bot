import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

/** Значения форм недоверенные: каждое поле проверяется на сервере */
export function text(fd: FormData, key: string, max: number): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function idField(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  return typeof v === "string" && ID_RE.test(v) ? v : null;
}

export function intField(fd: FormData, key: string, min: number, max: number): number | null {
  const v = fd.get(key);
  if (typeof v !== "string" || !/^-?\d{1,9}$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

export function checked(fd: FormData, key: string): boolean {
  return fd.get(key) === "on";
}

export function httpsUrl(v: string): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && v.length <= 500 ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Редирект обратно с кодом сообщения (?msg=…) */
export function done(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${msg}`);
}

export function audit(adminId: string, action: string, entityType: string, entityId?: string, meta?: Prisma.InputJsonValue) {
  return prisma.auditLog.create({ data: { adminId, action, entityType, entityId, meta } });
}

export function enqueueSync(entityType: "service" | "master" | "client" | "booking", entityId: string) {
  return prisma.syncQueue.create({ data: { entityType, entityId, action: "UPSERT" } });
}
