import Link from "next/link";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/admin/auth";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("logs");
  const sp = await searchParams;
  const action = typeof sp.action === "string" ? sp.action.trim().slice(0, 40) : "";
  const page = Math.min(1000, Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1));
  const where = action ? { action: { startsWith: action } } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { admin: { select: { email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  const zone = env().SALON_TIMEZONE;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/admin/logs?${new URLSearchParams({ ...(action ? { action } : {}), page: String(p) })}`;

  return (
    <>
      <h1>Журнал действий</h1>
      <p className="sub">Кто и что менял в панели, входы и смены статусов. Пароли и токены сюда не попадают.</p>
      <form className="filters" method="get">
        <label className="field">Действие начинается с<input name="action" defaultValue={action} placeholder="booking, staff, admin…" maxLength={40} /></label>
        <button className="btn" type="submit">Показать</button>
      </form>
      <div className="table-wrap">
        {rows.length === 0 ? <p className="empty">Записей нет.</p> : (
          <table className="t">
            <thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{DateTime.fromJSDate(r.createdAt, { zone }).toFormat("dd.MM.yyyy HH:mm")}</td>
                  <td>{r.admin?.email ?? "система"}</td>
                  <td>{r.action}</td>
                  <td>{r.entityType}{r.entityId ? ` ${r.entityId.slice(0, 8)}…` : ""}</td>
                  <td>{r.meta ? JSON.stringify(r.meta).slice(0, 160) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Страницы">
          {page > 1 && <Link prefetch={false} href={link(page - 1)}>Назад</Link>}
          <span>Страница {page} из {pages}</span>
          {page < pages && <Link prefetch={false} href={link(page + 1)}>Дальше</Link>}
        </nav>
      )}
    </>
  );
}
