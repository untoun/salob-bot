import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/admin/auth";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { Notice } from "../notice";

export const dynamic = "force-dynamic";
const PAGE = 50;
const EXTRA = { erased: { cls: "ok", text: "Персональные данные клиента удалены, история записей обезличена." } };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("clients");
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 60);
  const page = Math.min(10_000, Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1));
  const digits = q.replace(/\D/g, "");

  const or: Prisma.ClientWhereInput[] = [];
  if (q) or.push({ name: { contains: q, mode: "insensitive" } });
  if (digits.length >= 3) or.push({ phone: { contains: digits } });
  if (digits.length >= 5 && digits.length <= 15) or.push({ user: { maxUserId: BigInt(digits) } });
  const where: Prisma.ClientWhereInput = { anonymizedAt: null, ...(q ? { OR: or } : {}) };

  const [rows, total] = await Promise.all([
    prisma.client.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { user: { select: { maxUserId: true } } } }),
    prisma.client.count({ where }),
  ]);
  const zone = env().SALON_TIMEZONE;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (p: number) => `/admin/clients?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <h1>Клиенты</h1>
      <p className="sub">Найдено: {total}.</p>
      <Notice code={sp.msg} extra={EXTRA} />
      <form className="filters" method="get">
        <label className="field">Поиск<input type="search" name="q" defaultValue={q} placeholder="Имя, телефон или MAX ID" maxLength={60} /></label>
        <button className="btn" type="submit">Найти</button>
      </form>
      <div className="table-wrap">
        {rows.length === 0 ? <p className="empty">Клиенты не найдены.</p> : (
          <table className="t">
            <thead><tr><th>Имя</th><th>Телефон</th><th>MAX ID</th><th className="num">Визитов</th><th className="num">Отмен</th><th>Последний визит</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link prefetch={false} href={`/admin/clients/${c.id}`}>{c.name}</Link></td>
                  <td>{c.phone ?? "—"}</td>
                  <td>{c.user?.maxUserId.toString() ?? "—"}</td>
                  <td className="num">{c.visitsCount}</td>
                  <td className="num">{c.cancelsCount}</td>
                  <td>{c.lastVisitAt ? DateTime.fromJSDate(c.lastVisitAt, { zone }).toFormat("dd.MM.yyyy") : "—"}</td>
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
