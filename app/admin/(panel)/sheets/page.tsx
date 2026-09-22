import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getSetting } from "@/lib/db/settings";
import { isGoogleConfigured } from "@/lib/google/client";
import { Notice } from "../notice";
import { retryFailed, syncNow } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // ручная синхронизация может идти дольше обычной страницы

const EXTRA = {
  synced: { cls: "ok", text: "Синхронизация выполнена." },
  failed: { cls: "err", text: "Часть данных не удалось синхронизировать. Записи клиентов сохранены, попытки повторятся автоматически. Подробности — ниже." },
  notconfigured: { cls: "warn", text: "Google Таблица не настроена: заполните GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY и GOOGLE_SHEET_ID." },
  busy: { cls: "warn", text: "Синхронизация уже выполняется. Подождите минуту." },
  retried: { cls: "ok", text: "Неудачные задачи возвращены в очередь." },
};

export default async function SheetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("sheets");
  const sp = await searchParams;
  const configured = isGoogleConfigured();
  const [groups, failed, pendingBookings, errorBookings, last] = await Promise.all([
    prisma.syncQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.syncQueue.findMany({ where: { status: "FAILED" }, orderBy: { lastAttemptAt: "desc" }, take: 20 }),
    prisma.booking.count({ where: { syncStatus: "SYNC_PENDING" } }),
    prisma.booking.count({ where: { syncStatus: "SYNC_ERROR" } }),
    getSetting<{ at: string }>("google_reconcile_at"),
  ]);
  const count = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const id = env().GOOGLE_SHEET_ID;

  return (
    <>
      <h1>Google Таблица</h1>
      <p className="sub">Таблица — удобное окно для работы; основная база — PostgreSQL. Если Google недоступен, записи не теряются и синхронизируются позже.</p>
      <Notice code={sp.msg} extra={EXTRA} />

      <div className="kpis">
        <div className="kpi"><span>Подключение</span><strong>{configured ? "настроено" : "нет"}</strong>{configured && id && <small><a href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">Открыть таблицу</a></small>}</div>
        <div className="kpi"><span>В очереди</span><strong>{count("PENDING") + count("PROCESSING")}</strong><small>записей ждут отправки: {pendingBookings}</small></div>
        <div className="kpi"><span>Ошибки</span><strong>{count("FAILED")}</strong><small>записей с ошибкой: {errorBookings}</small></div>
        <div className="kpi"><span>Последняя сверка</span><strong>{last ? new Date(last.at).toLocaleString("ru-RU", { timeZone: env().SALON_TIMEZONE, dateStyle: "short", timeStyle: "short" }) : "—"}</strong></div>
      </div>

      <div className="cols" style={{ marginBottom: 22 }}>
        <form action={syncNow}><CsrfField /><button className="btn" type="submit">Синхронизировать сейчас</button></form>
        {count("FAILED") > 0 && <form action={retryFailed}><CsrfField /><button className="btn ghost" type="submit">Повторить неудачные</button></form>}
      </div>

      <section className="panel">
        <h2>Что можно править в таблице</h2>
        <ul className="rank">
          <li><span>Записи</span><span>статус и комментарий</span></li>
          <li><span>Клиенты</span><span>комментарий</span></li>
          <li><span>Услуги</span><span>название, описание, цена, «Цена от», длительность, активность</span></li>
          <li><span>Мастера</span><span>имя, телефон, специализация, статус</span></li>
          <li><span>Расписание, Акции, Настройки, Статистика</span><span>только просмотр</span></li>
        </ul>
      </section>

      {failed.length > 0 && (
        <section className="panel">
          <h2>Неудачные задачи</h2>
          <ul className="rank">
            {failed.map((f) => (
              <li key={f.id}><span>{f.entityType} {f.entityId.slice(0, 8)}…</span><span>{f.error ?? "ошибка"}</span></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
