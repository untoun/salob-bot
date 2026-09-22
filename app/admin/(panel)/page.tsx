import { DateTime } from "luxon";
import { BarChart } from "@/components/admin/BarChart";
import { DayTimeline } from "@/components/admin/DayTimeline";
import { requireAdmin } from "@/lib/admin/auth";
import { bookingScope } from "@/lib/admin/permissions";
import { loadDashboard } from "@/lib/admin/stats";
import { env } from "@/lib/config/env";
import { formatPrice } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("dashboard");
  const sp = await searchParams;
  const isMaster = admin.role === "MASTER";
  const d = await loadDashboard(bookingScope(admin), { showClients: !isMaster });
  const dateLabel = DateTime.now().setZone(env().SALON_TIMEZONE).setLocale("ru").toLocaleString({ weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <h1>Сегодня, {dateLabel}</h1>
      <p className="sub">{isMaster ? "Ваши записи на сегодня." : "Записи по мастерам на сегодня."}</p>

      {sp.denied && (
        <div className="notice warn" role="alert">
          Недостаточно прав для этого действия.
        </div>
      )}

      <section className="panel" aria-label="Лента дня">
        <DayTimeline masters={d.timeline} />
      </section>

      <div className="kpis">
        <div className="kpi">
          <span>Записей сегодня</span>
          <strong>{d.todayCount}</strong>
          <small>завтра: {d.tomorrowCount}</small>
        </div>
        <div className="kpi">
          <span>Выручка сегодня</span>
          <strong>{formatPrice(d.revenueToday)}</strong>
          <small>ожидается ещё {formatPrice(d.expectedToday)}</small>
        </div>
        <div className="kpi">
          <span>Выручка за 7 дней</span>
          <strong>{formatPrice(d.revenueWeek)}</strong>
          <small>завершено: {d.completedWeek}</small>
        </div>
        <div className="kpi">
          <span>Отмены за 7 дней</span>
          <strong>{d.cancelsWeek}</strong>
        </div>
        {d.newClientsWeek !== null && (
          <div className="kpi">
            <span>Новые клиенты за 7 дней</span>
            <strong>{d.newClientsWeek}</strong>
          </div>
        )}
      </div>

      <div className="grid2">
        <section className="panel">
          <h2>Записи по дням</h2>
          <BarChart data={d.perDay.map((x) => ({ label: x.label, value: x.count, highlight: x.isToday }))} />
        </section>
        <section className="panel">
          <h2>Выручка по дням, ₽</h2>
          <BarChart data={d.perDay.map((x) => ({ label: x.label, value: x.revenue, highlight: x.isToday }))} />
        </section>
        <section className="panel">
          <h2>Популярные услуги за 30 дней</h2>
          {d.topServices.length ? (
            <ul className="rank">
              {d.topServices.map((s) => (
                <li key={s.name}>
                  <span>{s.name}</span>
                  <b>{s.count}</b>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${(s.count / Math.max(1, d.topServices[0]?.count ?? 1)) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Пока нет данных: записи появятся здесь после первых визитов.</p>
          )}
        </section>
        <section className="panel">
          <h2>Загрузка на 7 дней вперёд</h2>
          {d.load.length ? (
            <ul className="rank">
              {d.load.map((m) => (
                <li key={m.name}>
                  <span>{m.name}</span>
                  <b>{m.percent}%</b>
                  <span className="meter" aria-hidden="true">
                    <i style={{ width: `${m.percent}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Нет активных мастеров с графиком работы.</p>
          )}
        </section>
      </div>
    </>
  );
}
