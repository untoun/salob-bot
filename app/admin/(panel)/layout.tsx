import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { can, ROLE_LABEL, type Permission } from "@/lib/admin/permissions";
import { env } from "@/lib/config/env";
import { Sidebar, type NavItem } from "@/components/admin/Sidebar";

// Части раздела «Панель» добавляются по мере готовности; пункт виден только при наличии права.
const NAV: (NavItem & { perm: Permission })[] = [
  { href: "/admin", label: "Обзор", perm: "dashboard" },
  { href: "/admin/calendar", label: "Календарь", perm: "calendar" },
  { href: "/admin/bookings", label: "Записи", perm: "bookings:read" },
  { href: "/admin/clients", label: "Клиенты", perm: "clients" },
  { href: "/admin/services", label: "Услуги", perm: "services" },
  { href: "/admin/masters", label: "Мастера", perm: "masters" },
  { href: "/admin/schedule", label: "Расписание", perm: "schedule" },
  { href: "/admin/promos", label: "Акции", perm: "promos" },
  { href: "/admin/faq", label: "Вопросы и ответы", perm: "faq" },
  { href: "/admin/sheets", label: "Google Таблица", perm: "sheets" },
  { href: "/admin/staff", label: "Сотрудники", perm: "admins" },
  { href: "/admin/logs", label: "Журнал", perm: "logs" },
];

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { admin, csrf } = await requireAdmin();
  const items = NAV.filter((n) => can(admin.role, n.perm)).map((n) => ({ href: n.href, label: n.label }));
  return (
    <div className="shell">
      <Sidebar items={items} name={env().SALON_NAME} role={`${ROLE_LABEL[admin.role]} · ${admin.email}`} csrf={csrf} />
      <main className="main">{children}</main>
    </div>
  );
}
