import Link from "next/link";
import type { BookingStatus } from "@prisma/client";
import { notFound } from "next/navigation";
import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { ID_RE } from "@/lib/admin/forms";
import { bookingScope, can } from "@/lib/admin/permissions";
import { canTransition } from "@/lib/booking/status-rules";
import { STATUS_RU } from "@/lib/google/labels";
import { prisma } from "@/lib/db/prisma";
import { maskPhone } from "@/lib/logging/logger";
import { formatDuration, formatPrice } from "@/lib/utils/format";
import { formatDateRu, formatTimeLocal } from "@/lib/utils/time";
import { Notice } from "../../notice";
import { changeBookingStatus, saveBookingComment } from "../actions";

export const dynamic = "force-dynamic";
const SETTABLE: BookingStatus[] = ["CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"];
const EXTRA = {
  ok: { cls: "ok", text: "Сохранено." },
  created: { cls: "ok", text: "Запись создана. Клиенту с аккаунтом в MAX отправлено уведомление." },
  moved: { cls: "ok", text: "Запись перенесена. Клиент с аккаунтом в MAX уведомлён." },
  rejected: { cls: "warn", text: "Так менять статус нельзя: отменённую или завершённую запись не вернуть в работу." },
  missing: { cls: "err", text: "Запись не найдена." },
  bad: { cls: "err", text: "Некорректный запрос." },
  error: { cls: "err", text: "Не удалось сохранить. Попробуйте ещё раз." },
};

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("bookings:read");
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const sp = await searchParams;
  // ограничение по роли: мастер откроет только свою запись
  const b = await prisma.booking.findFirst({
    where: { id, ...bookingScope(admin) },
    include: { client: true, master: true, service: true, rescheduledFrom: { select: { id: true } }, rescheduledTo: { select: { id: true } } },
  });
  if (!b) notFound();
  const isMaster = admin.role === "MASTER";
  const canWrite = can(admin.role, "bookings:write");
  const back = `/admin/bookings/${b.id}`;
  const options = SETTABLE.filter((s) => canTransition(b.status, s));
  const live = ["NEW", "CONFIRMED"].includes(b.status);

  return (
    <>
      <h1>{b.service.name}</h1>
      <p className="sub"><Link prefetch={false} href="/admin/bookings">← Все записи</Link></p>
      <Notice code={sp.msg} extra={EXTRA} />

      <section className="panel">
        <ul className="rank">
          <li><span>Когда</span><b>{formatDateRu(b.startsAt)}, {formatTimeLocal(b.startsAt)} · {formatDuration(b.durationMin)}</b></li>
          <li><span>Мастер</span><b>{b.master.name}</b></li>
          <li><span>Клиент</span><b>{isMaster ? b.client.name : <Link prefetch={false} href={`/admin/clients/${b.clientId}`}>{b.client.name}</Link>}</b></li>
          <li><span>Телефон</span><b>{isMaster ? (maskPhone(b.client.phone) ?? "—") : (b.client.phone ?? "—")}</b></li>
          <li><span>Стоимость</span><b>{formatPrice(b.priceRub, b.priceFrom)}</b></li>
          <li><span>Статус</span><span className={`badge b-${b.status}`}>{STATUS_RU[b.status]}</span></li>
          <li><span>Источник</span><b>{b.source === "admin" ? "администратор" : b.source === "max_bot" ? "бот MAX" : b.source}</b></li>
          {b.rescheduledFrom && <li><span>Перенесена с</span><Link prefetch={false} href={`/admin/bookings/${b.rescheduledFrom.id}`}>предыдущая запись</Link></li>}
          {b.rescheduledTo && <li><span>Перенесена на</span><Link prefetch={false} href={`/admin/bookings/${b.rescheduledTo.id}`}>новая запись</Link></li>}
        </ul>
      </section>

      {canWrite && (
        <div className="grid2">
          {options.length > 0 && (
            <section className="panel">
              <h2>Статус</h2>
              <form action={changeBookingStatus} className="rowform">
                <CsrfField />
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="back" value={back} />
                <select name="status" aria-label="Новый статус" defaultValue={options[0]}>
                  {options.map((s) => <option key={s} value={s}>{STATUS_RU[s]}</option>)}
                </select>
                <button className="btn small" type="submit">Сохранить</button>
              </form>
              <p className="sub" style={{ marginTop: 10 }}>При отмене клиент получит сообщение в MAX.</p>
            </section>
          )}
          {live && (
            <section className="panel">
              <h2>Перенос</h2>
              <p className="sub">Выберите новую дату и время — свободные слоты считаются по графику мастера.</p>
              <Link prefetch={false} className="btn" href={`/admin/calendar/new?move=${b.id}`}>Перенести запись</Link>
            </section>
          )}
          <section className="panel">
            <h2>Комментарий</h2>
            <form action={saveBookingComment} className="stack">
              <CsrfField />
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="back" value={back} />
              <label className="field">Заметка<input name="comment" maxLength={500} defaultValue={b.comment ?? ""} /></label>
              <div><button className="btn small" type="submit">Сохранить</button></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
