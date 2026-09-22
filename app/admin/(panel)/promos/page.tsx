import { DateTime } from "luxon";
import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { Notice } from "../notice";
import { deletePromo, savePromo } from "./actions";

export const dynamic = "force-dynamic";

type P = { id: string; title: string; description: string; discountText: string | null; conditions: string | null; startsAt: Date; endsAt: Date; active: boolean };

function PromoForm({ p, zone }: { p?: P; zone: string }) {
  const d = (x?: Date) => (x ? DateTime.fromJSDate(x, { zone }).toISODate()! : "");
  return (
    <form action={savePromo} className="stack">
      <CsrfField />
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="cols">
        <label className="field">Название<input name="title" required maxLength={100} defaultValue={p?.title} /></label>
        <label className="field">Скидка<input name="discountText" maxLength={40} placeholder="−20% или 500 ₽" defaultValue={p?.discountText ?? ""} /></label>
        <label className="field">Начало<input type="date" name="startsOn" required defaultValue={d(p?.startsAt)} /></label>
        <label className="field">Окончание (включительно)<input type="date" name="endsOn" required defaultValue={d(p?.endsAt)} /></label>
      </div>
      <label className="field">Описание<input name="description" required maxLength={1000} defaultValue={p?.description} /></label>
      <label className="field">Условия<input name="conditions" maxLength={500} defaultValue={p?.conditions ?? ""} /></label>
      {p && <label className="check"><input type="checkbox" name="active" defaultChecked={p.active} /> Включена</label>}
      <div><button className="btn" type="submit">{p ? "Сохранить акцию" : "Добавить акцию"}</button></div>
    </form>
  );
}

export default async function PromosPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("promos");
  const sp = await searchParams;
  const zone = env().SALON_TIMEZONE;
  const now = new Date();
  const promos = await prisma.promotion.findMany({ orderBy: { endsAt: "desc" }, take: 100 });

  return (
    <>
      <h1>Акции</h1>
      <p className="sub">Бот показывает клиентам только акции, которые включены и действуют сегодня.</p>
      <Notice code={sp.msg} />
      {promos.map((p) => {
        const live = p.active && p.startsAt <= now && p.endsAt >= now;
        return (
          <details className="edit panel" key={p.id}>
            <summary>
              <b>{p.title}</b> — {DateTime.fromJSDate(p.startsAt, { zone }).toFormat("dd.MM.yyyy")}–{DateTime.fromJSDate(p.endsAt, { zone }).toFormat("dd.MM.yyyy")}
              {live ? " · показывается клиентам" : p.active ? " · вне срока" : " · выключена"}
            </summary>
            <PromoForm p={p} zone={zone} />
            <form action={deletePromo} style={{ marginTop: 10 }}>
              <CsrfField />
              <input type="hidden" name="id" value={p.id} />
              <button className="btn small ghost" type="submit">Удалить акцию</button>
            </form>
          </details>
        );
      })}
      <section className="panel">
        <h2>Новая акция</h2>
        <PromoForm zone={zone} />
      </section>
    </>
  );
}
