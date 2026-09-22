import Link from "next/link";
import { DateTime } from "luxon";
import { requireAdmin } from "@/lib/admin/auth";
import { columnCells, loadCounts, loadDay, loadWeek, parseDate } from "@/lib/admin/calendar";
import { ID_RE } from "@/lib/admin/forms";
import { bookingScope, can } from "@/lib/admin/permissions";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { minutesToHHmm } from "@/lib/utils/time";

export const dynamic = "force-dynamic";
type View = "day" | "week" | "month";
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("calendar");
  const sp = await searchParams;
  const zone = env().SALON_TIMEZONE;
  const scope = bookingScope(admin);
  const canWrite = can(admin.role, "bookings:write");
  const view: View = one(sp.view) === "week" ? "week" : one(sp.view) === "month" ? "month" : "day";
  const date = parseDate(one(sp.date));
  const d = DateTime.fromISO(date, { zone }).setLocale("ru");

  const masters = await prisma.master.findMany({ where: { active: true, ...(scope.masterId ? { id: scope.masterId } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const wantedMaster = one(sp.master) && ID_RE.test(one(sp.master)!) ? one(sp.master)! : undefined;
  // мастер видит только себя; остальные могут выбрать мастера либо смотреть всех (день/месяц)
  const masterId = scope.masterId ?? (masters.some((m) => m.id === wantedMaster) ? wantedMaster : undefined);
  const weekMaster = masterId ?? masters[0]?.id;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ view, date, ...(masterId ? { master: masterId } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `/admin/calendar?${p}`;
  };
  const step = view === "day" ? { days: 1 } : view === "week" ? { weeks: 1 } : { months: 1 };
  const prev = d.minus(step).toISODate()!;
  const next = d.plus(step).toISODate()!;
  const title = view === "day" ? d.toLocaleString({ weekday: "long", day: "numeric", month: "long", year: "numeric" }) : view === "week" ? `Неделя с ${d.startOf("week").toFormat("dd.MM")}` : d.toFormat("LLLL yyyy");

  return (
    <>
      <h1>Календарь</h1>
      <p className="sub">{title}</p>

      <div className="filters">
        <nav className="seg" aria-label="Вид">
          {(["day", "week", "month"] as const).map((v) => (
            <Link prefetch={false} key={v} href={qs({ view: v })} aria-current={view === v ? "page" : undefined}>{v === "day" ? "День" : v === "week" ? "Неделя" : "Месяц"}</Link>
          ))}
        </nav>
        <Link prefetch={false} className="btn ghost small" href={qs({ date: prev })}>← Назад</Link>
        <Link prefetch={false} className="btn ghost small" href={qs({ date: undefined })}>Сегодня</Link>
        <Link prefetch={false} className="btn ghost small" href={qs({ date: next })}>Вперёд →</Link>
        {!scope.masterId && (
          <form method="get" className="rowform">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={date} />
            <select name="master" defaultValue={masterId ?? ""} aria-label="Мастер">
              {view !== "week" && <option value="">Все мастера</option>}
              {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn small ghost" type="submit">Показать</button>
          </form>
        )}
        {canWrite && <Link prefetch={false} className="btn small" href="/admin/calendar/new">+ Новая запись</Link>}
      </div>

      <ul className="legend" aria-label="Обозначения">
        <li><i className="c-free" /> свободно</li>
        <li><i className="c-busy" /> занято</li>
        <li><i className="c-break" /> перерыв</li>
        <li><i className="c-off" /> выходной</li>
      </ul>

      {view === "day" && <DayView date={date} masterIds={masterId ? [masterId] : scope.masterId ? [scope.masterId] : undefined} canWrite={canWrite} />}
      {view === "week" && (weekMaster ? <WeekView date={date} masterId={weekMaster} zone={zone} /> : <p className="empty">Нет активных мастеров.</p>)}
      {view === "month" && <MonthView date={date} masterId={masterId} zone={zone} />}
    </>
  );
}

async function DayView({ date, masterIds, canWrite }: { date: string; masterIds?: string[]; canWrite: boolean }) {
  const cols = await loadDay(date, masterIds);
  if (!cols.length) return <p className="empty">Нет активных мастеров.</p>;
  const starts = cols.flatMap((c) => [c.window?.startMin, ...c.bookings.map((b) => b.startMin)]).filter((x): x is number => x !== undefined);
  const ends = cols.flatMap((c) => [c.window?.endMin, ...c.bookings.map((b) => b.endMin)]).filter((x): x is number => x !== undefined);
  const from = Math.floor((starts.length ? Math.min(...starts) : 9 * 60) / 60) * 60;
  const to = Math.ceil((ends.length ? Math.max(...ends) : 19 * 60) / 60) * 60;
  const cells = cols.map((c) => columnCells(c.window, c.bookings, from, to));
  const rows = Math.max(0, Math.ceil((to - from) / 30));

  return (
    <div className="table-wrap">
      <table className="cal">
        <thead>
          <tr><th scope="col">Время</th>{cols.map((c) => <th scope="col" key={c.master.id}>{c.master.name}{!c.window && <small> · выходной</small>}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              <th scope="row">{minutesToHHmm(from + r * 30)}</th>
              {cells.map((col, i) => {
                const cell = col[r]!;
                const m = cols[i]!.master;
                return (
                  <td key={m.id} className={`c-${cell.state}`}>
                    {cell.state === "busy" && cell.first && cell.booking && (
                      <Link prefetch={false} href={`/admin/bookings/${cell.booking.id}`}>{minutesToHHmm(cell.booking.startMin)} {cell.booking.label} — {cell.booking.client}</Link>
                    )}
                    {cell.state === "free" && canWrite && (
                      <Link prefetch={false} className="plus" href={`/admin/calendar/new?master=${m.id}&date=${date}`} aria-label={`Записать к мастеру ${m.name} на ${minutesToHHmm(from + r * 30)}`}>+</Link>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function WeekView({ date, masterId, zone }: { date: string; masterId: string; zone: string }) {
  const monday = DateTime.fromISO(date, { zone }).startOf("week").toISODate()!;
  const week = await loadWeek(monday, masterId);
  return (
    <div className="weekgrid">
      {week.map(({ iso, col }) => {
        const day = DateTime.fromISO(iso, { zone }).setLocale("ru");
        return (
          <section key={iso} className={`weekday ${col?.window ? "" : "c-off"}`}>
            <h3><Link prefetch={false} href={`/admin/calendar?view=day&date=${iso}&master=${masterId}`}>{day.toFormat("ccc dd.MM")}</Link></h3>
            {!col?.window && <p>выходной</p>}
            {col?.bookings.sort((a, b) => a.startMin - b.startMin).map((b) => (
              <Link prefetch={false} key={b.id} className="chip" href={`/admin/bookings/${b.id}`}><b>{minutesToHHmm(b.startMin)}</b> {b.label}<small>{b.client}</small></Link>
            ))}
            {col?.window && col.bookings.length === 0 && <p>записей нет</p>}
          </section>
        );
      })}
    </div>
  );
}

async function MonthView({ date, masterId, zone }: { date: string; masterId?: string; zone: string }) {
  const first = DateTime.fromISO(date, { zone }).startOf("month");
  const gridStart = first.startOf("week");
  const gridEnd = first.endOf("month").endOf("week");
  const counts = await loadCounts(gridStart.toISODate()!, gridEnd.toISODate()!, masterId);
  const days: DateTime[] = [];
  for (let x = gridStart; x <= gridEnd; x = x.plus({ days: 1 })) days.push(x);
  const max = Math.max(1, ...counts.values());

  return (
    <div className="month">
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((n) => <div className="mh" key={n}>{n}</div>)}
      {days.map((x) => {
        const iso = x.toISODate()!;
        const n = counts.get(iso) ?? 0;
        return (
          <Link prefetch={false} key={iso} className={`md${x.month !== first.month ? " other" : ""}`} href={`/admin/calendar?view=day&date=${iso}${masterId ? `&master=${masterId}` : ""}`} style={{ ["--load" as string]: n / max }}>
            <span>{x.day}</span>
            {n > 0 && <b>{n}</b>}
          </Link>
        );
      })}
    </div>
  );
}
