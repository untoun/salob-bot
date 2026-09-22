import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { prisma } from "@/lib/db/prisma";
import { formatDuration, formatPrice } from "@/lib/utils/format";
import { Notice } from "../notice";
import { saveCategory, saveService } from "./actions";

export const dynamic = "force-dynamic";

type Cat = { id: string; name: string }[];

function ServiceForm({ categories, s }: { categories: Cat; s?: { id: string; categoryId: string; name: string; description: string | null; priceRub: number; priceFrom: boolean; durationMin: number; isAddon: boolean; active: boolean; sortOrder: number } }) {
  return (
    <form action={saveService} className="stack">
      <CsrfField />
      {s && <input type="hidden" name="id" value={s.id} />}
      <div className="cols">
        <label className="field">
          Название
          <input name="name" required maxLength={100} defaultValue={s?.name} />
        </label>
        <label className="field">
          Категория
          <select name="categoryId" defaultValue={s?.categoryId} required>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Цена, ₽
          <input name="priceRub" type="number" min={0} max={1000000} required defaultValue={s?.priceRub} />
        </label>
        <label className="field">
          Длительность, мин
          <input name="durationMin" type="number" min={5} max={720} required defaultValue={s?.durationMin ?? 60} />
        </label>
        <label className="field">
          Порядок
          <input name="sortOrder" type="number" min={0} max={999} defaultValue={s?.sortOrder ?? 0} />
        </label>
      </div>
      <label className="field">
        Описание
        <input name="description" maxLength={1000} defaultValue={s?.description ?? ""} />
      </label>
      <div className="checks">
        <label className="check"><input type="checkbox" name="priceFrom" defaultChecked={s?.priceFrom} /> Цена «от» (зависит от длины волос)</label>
        <label className="check"><input type="checkbox" name="isAddon" defaultChecked={s?.isAddon} /> Дополнительная услуга (предлагается к основной)</label>
        {s && <label className="check"><input type="checkbox" name="active" defaultChecked={s.active} /> Показывать клиентам</label>}
      </div>
      <div><button className="btn" type="submit">{s ? "Сохранить услугу" : "Добавить услугу"}</button></div>
    </form>
  );
}

export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("services");
  const sp = await searchParams;
  const categories = await prisma.serviceCategory.findMany({ orderBy: { sortOrder: "asc" }, include: { services: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } } });
  const cats: Cat = categories.map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
      <h1>Услуги</h1>
      <p className="sub">Названия, цены и длительность видят клиенты в боте и AI-помощник. Изменения попадают в Google Таблицу автоматически.</p>
      <Notice code={sp.msg} />

      {categories.map((c) => (
        <section className="panel" key={c.id}>
          <h2>{c.name}{!c.active && " (скрыта)"}</h2>
          <details className="edit">
            <summary>Изменить категорию</summary>
            <form action={saveCategory} className="cols">
              <CsrfField />
              <input type="hidden" name="id" value={c.id} />
              <label className="field">Название<input name="name" required maxLength={60} defaultValue={c.name} /></label>
              <label className="field">Порядок<input name="sortOrder" type="number" min={0} max={999} defaultValue={c.sortOrder} /></label>
              <label className="check"><input type="checkbox" name="active" defaultChecked={c.active} /> Показывать</label>
              <button className="btn small" type="submit">Сохранить</button>
            </form>
          </details>
          {c.services.length === 0 && <p className="empty">В категории пока нет услуг.</p>}
          {c.services.map((s) => (
            <details className="edit" key={s.id}>
              <summary>
                <b>{s.name}</b> — {formatPrice(s.priceRub, s.priceFrom)}, {formatDuration(s.durationMin)}
                {s.isAddon && " · допуслуга"}
                {!s.active && " · скрыта"}
              </summary>
              <ServiceForm categories={cats} s={s} />
            </details>
          ))}
        </section>
      ))}

      <section className="panel">
        <h2>Новая категория</h2>
        <form action={saveCategory} className="cols">
          <CsrfField />
          <label className="field">Название<input name="name" required maxLength={60} /></label>
          <label className="field">Порядок<input name="sortOrder" type="number" min={0} max={999} defaultValue={0} /></label>
          <button className="btn" type="submit">Добавить категорию</button>
        </form>
      </section>

      {cats.length > 0 && (
        <section className="panel">
          <h2>Новая услуга</h2>
          <ServiceForm categories={cats} />
        </section>
      )}
    </>
  );
}
