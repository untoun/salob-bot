import Link from "next/link";
import { notFound } from "next/navigation";
import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { ID_RE } from "@/lib/admin/forms";
import { can } from "@/lib/admin/permissions";
import { STATUS_RU } from "@/lib/google/labels";
import { prisma } from "@/lib/db/prisma";
import { formatPrice } from "@/lib/utils/format";
import { formatDateRu, formatTimeLocal } from "@/lib/utils/time";
import { Notice } from "../../notice";
import { deleteClientData, saveClientComment } from "../actions";

export const dynamic = "force-dynamic";
const EXTRA = {
  confirm: { cls: "err", text: "Отметьте подтверждение: удаление необратимо." },
  has_future: { cls: "err", text: "У клиента есть будущие записи. Сначала отмените их, затем удаляйте данные." },
  already: { cls: "warn", text: "Данные этого клиента уже удалены." },
};

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("clients");
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const sp = await searchParams;
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      user: { select: { maxUserId: true, source: true, consentAt: true } },
      bookings: { orderBy: { startsAt: "desc" }, take: 50, include: { service: { select: { name: true } }, master: { select: { name: true } } } },
    },
  });
  if (!c || c.anonymizedAt) notFound();
  const future = c.bookings.filter((b) => b.startsAt > new Date() && ["NEW", "CONFIRMED"].includes(b.status));

  return (
    <>
      <h1>{c.name}</h1>
      <p className="sub">
        {c.phone ?? "телефон не указан"} · MAX ID {c.user?.maxUserId.toString() ?? "—"} · визитов {c.visitsCount}, отмен {c.cancelsCount}
        {c.user?.consentAt ? "" : " · согласие на обработку данных не зафиксировано"}
      </p>
      <Notice code={sp.msg} extra={EXTRA} />

      {future.length > 0 && (
        <section className="panel">
          <h2>Будущие записи</h2>
          <ul className="rank">
            {future.map((b) => (
              <li key={b.id}><Link prefetch={false} href={`/admin/bookings/${b.id}`}>{formatDateRu(b.startsAt)}, {formatTimeLocal(b.startsAt)}</Link><span>{b.service.name}, {b.master.name}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Комментарий</h2>
        <form action={saveClientComment} className="stack">
          <CsrfField />
          <input type="hidden" name="id" value={c.id} />
          <label className="field">Заметка для сотрудников<input name="comment" maxLength={500} defaultValue={c.comment ?? ""} /></label>
          <div><button className="btn" type="submit">Сохранить</button></div>
        </form>
      </section>

      <section className="panel">
        <h2>История записей</h2>
        {c.bookings.length === 0 ? <p className="empty">Записей пока нет.</p> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 560 }}>
            <thead><tr><th>Когда</th><th>Услуга</th><th>Мастер</th><th className="num">Стоимость</th><th>Статус</th></tr></thead>
            <tbody>
              {c.bookings.map((b) => (
                <tr key={b.id}>
                  <td><Link prefetch={false} href={`/admin/bookings/${b.id}`}>{formatDateRu(b.startsAt)}, {formatTimeLocal(b.startsAt)}</Link></td>
                  <td>{b.service.name}</td><td>{b.master.name}</td>
                  <td className="num">{formatPrice(b.priceRub, b.priceFrom)}</td>
                  <td><span className={`badge b-${b.status}`}>{STATUS_RU[b.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      {can(admin.role, "admins") && (
        <section className="panel">
          <h2>Удалить данные клиента</h2>
          <p className="sub">По запросу клиента: имя, телефон, комментарий и MAX-профиль удаляются, история записей остаётся без персональных данных. Строки в Google Таблице обезличиваются автоматически.</p>
          <form action={deleteClientData} className="stack">
            <CsrfField />
            <input type="hidden" name="id" value={c.id} />
            <label className="check"><input type="checkbox" name="confirm" /> Я понимаю, что это необратимо</label>
            <div><button className="btn ghost" type="submit">Удалить данные</button></div>
          </form>
        </section>
      )}
    </>
  );
}
