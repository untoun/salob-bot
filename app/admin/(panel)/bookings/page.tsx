import Link from "next/link";
import type { BookingStatus } from "@prisma/client";
import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { buildWhere, PAGE_SIZE, parseFilters } from "@/lib/admin/bookings-query";
import { bookingScope, can } from "@/lib/admin/permissions";
import { STATUS_RU } from "@/lib/google/labels";
import { canTransition } from "@/lib/booking/status-rules";
import { prisma } from "@/lib/db/prisma";
import { maskPhone } from "@/lib/logging/logger";
import { formatPrice } from "@/lib/utils/format";
import { formatDateRu, formatTimeLocal } from "@/lib/utils/time";
import { changeBookingStatus } from "./actions";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, { cls: string; text: string }> = {
  ok: { cls: "ok", text: "Статус обновлён." },
  rejected: { cls: "warn", text: "Так менять статус нельзя: отменённую или завершённую запись не вернуть в работу." },
  missing: { cls: "err", text: "Запись не найдена." },
  bad: { cls: "err", text: "Некорректный запрос." },
  error: { cls: "err", text: "Не удалось сохранить изменение. Попробуйте ещё раз." },
};

const SETTABLE: BookingStatus[] = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("bookings:read");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const scope = bookingScope(admin);
  const canWrite = can(admin.role, "bookings:write");
  const isMaster = admin.role === "MASTER";
  const where = buildWhere(f, scope);

  const [rows, total, masters] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { startsAt: "asc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { client: { select: { name: true, phone: true } }, master: { select: { name: true } }, service: { select: { name: true } } },
    }),
    prisma.booking.count({ where }),
    isMaster ? Promise.resolve([]) : prisma.master.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const base = { from: f.from, to: f.to, status: f.status, master: f.masterId, q: f.q, page: f.page, ...over };
    for (const [k, v] of Object.entries(base)) if (v !== undefined && v !== "") p.set(k, String(v));
    return p.toString();
  };
  const here = `/admin/bookings?${qs({})}`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const notice = typeof sp.msg === "string" ? NOTICES[sp.msg] : undefined;

  return (
    <>
      <h1>Записи</h1>
      <p className="sub">{isMaster ? "Ваши записи." : "Все записи салона."} Найдено: {total}.</p>

      {notice && (
        <div className={`notice ${notice.cls}`} role="status">
          {notice.text}
        </div>
      )}

      <form className="filters" method="get">
        <label className="field">
          С даты
          <input type="date" name="from" defaultValue={f.from} />
        </label>
        <label className="field">
          По дату
          <input type="date" name="to" defaultValue={f.to} />
        </label>
        <label className="field">
          Статус
          <select name="status" defaultValue={f.status ?? ""}>
            <option value="">Любой</option>
            {(Object.keys(STATUS_RU) as BookingStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_RU[s]}
              </option>
            ))}
          </select>
        </label>
        {!isMaster && (
          <label className="field">
            Мастер
            <select name="master" defaultValue={f.masterId ?? ""}>
              <option value="">Все</option>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!isMaster && (
          <label className="field">
            Клиент
            <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Имя или телефон" maxLength={60} />
          </label>
        )}
        <button className="btn" type="submit">
          Показать
        </button>
      </form>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <p className="empty">В этом периоде записей нет. Измените даты или фильтры.</p>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Клиент</th>
                <th>Телефон</th>
                <th>Услуга</th>
                <th>Мастер</th>
                <th className="num">Стоимость</th>
                <th>Статус</th>
                {canWrite && <th>Изменить статус</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const options = SETTABLE.filter((s) => canTransition(b.status, s));
                return (
                  <tr key={b.id}>
                    <td>
                      {formatDateRu(b.startsAt)}, {formatTimeLocal(b.startsAt)}
                    </td>
                    <td>{b.client.name}</td>
                    <td>{isMaster ? maskPhone(b.client.phone) ?? "—" : (b.client.phone ?? "—")}</td>
                    <td>{b.service.name}</td>
                    <td>{b.master.name}</td>
                    <td className="num">{formatPrice(b.priceRub, b.priceFrom)}</td>
                    <td>
                      <span className={`badge b-${b.status}`}>{STATUS_RU[b.status]}</span>
                    </td>
                    {canWrite && (
                      <td>
                        {options.length ? (
                          <form className="rowform" action={changeBookingStatus}>
                            <CsrfField />
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="back" value={here} />
                            <select name="status" aria-label="Новый статус" defaultValue={options[0]}>
                              {options.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_RU[s]}
                                </option>
                              ))}
                            </select>
                            <button className="btn small ghost" type="submit">
                              Сохранить
                            </button>
                          </form>
                        ) : (
                          <span style={{ color: "var(--ink-2)" }}>—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <nav className="pager" aria-label="Страницы">
          {f.page > 1 && <Link prefetch={false} href={`/admin/bookings?${qs({ page: f.page - 1 })}`}>Назад</Link>}
          <span>
            Страница {f.page} из {pages}
          </span>
          {f.page < pages && <Link prefetch={false} href={`/admin/bookings?${qs({ page: f.page + 1 })}`}>Дальше</Link>}
        </nav>
      )}
    </>
  );
}
