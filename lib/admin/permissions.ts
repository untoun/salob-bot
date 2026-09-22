import type { AdminRole } from "@prisma/client";

export type Permission =
  | "dashboard"
  | "bookings:read"
  | "bookings:write"
  | "calendar"
  | "clients"
  | "masters"
  | "services"
  | "promos"
  | "faq"
  | "schedule"
  | "schedule:write"
  | "portfolio"
  | "sheets"
  | "stats"
  | "settings"
  | "logs"
  | "admins";

const ALL: Permission[] = [
  "dashboard", "bookings:read", "bookings:write", "calendar", "clients", "masters", "services", "promos",
  "faq", "schedule", "schedule:write", "portfolio", "sheets", "stats", "settings", "logs", "admins",
];

const MATRIX: Record<AdminRole, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(ALL),
  // ADMIN: записи, клиенты, расписание, услуги, акции (+ календарь, FAQ, портфолио, статистика)
  ADMIN: new Set<Permission>(["dashboard", "bookings:read", "bookings:write", "calendar", "clients", "services", "promos", "faq", "schedule", "schedule:write", "portfolio", "stats"]),
  // MASTER: только своё расписание и свои записи, без записи изменений
  MASTER: new Set<Permission>(["dashboard", "bookings:read", "calendar", "schedule"]),
};

export function can(role: AdminRole, perm: Permission): boolean {
  return MATRIX[role].has(perm);
}

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: "Владелец",
  ADMIN: "Администратор",
  MASTER: "Мастер",
};

/** Ограничение выборки записей по роли: мастер видит только свои */
export function bookingScope(admin: { role: AdminRole; masterId: string | null }): { masterId?: string } {
  if (admin.role !== "MASTER") return {};
  return { masterId: admin.masterId ?? "__no_master__" }; // мастер без привязки не видит ничего
}
