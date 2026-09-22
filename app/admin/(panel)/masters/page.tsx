import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { prisma } from "@/lib/db/prisma";
import { Notice } from "../notice";
import { saveMaster } from "./actions";

export const dynamic = "force-dynamic";

type M = { id: string; name: string; phone: string | null; specialization: string | null; experienceYears: number | null; bio: string | null; photoUrl: string | null; rating: number | null; active: boolean; serviceIds: string[] };
type Svc = { id: string; name: string }[];

function MasterForm({ services, m }: { services: Svc; m?: M }) {
  return (
    <form action={saveMaster} className="stack">
      <CsrfField />
      {m && <input type="hidden" name="id" value={m.id} />}
      <div className="cols">
        <label className="field">Имя<input name="name" required maxLength={100} defaultValue={m?.name} /></label>
        <label className="field">Специализация<input name="specialization" maxLength={100} defaultValue={m?.specialization ?? ""} /></label>
        <label className="field">Телефон<input name="phone" maxLength={30} defaultValue={m?.phone ?? ""} /></label>
        <label className="field">Опыт, лет<input name="experienceYears" type="number" min={0} max={80} defaultValue={m?.experienceYears ?? ""} /></label>
        <label className="field">Рейтинг (0–5)<input name="rating" inputMode="decimal" maxLength={4} defaultValue={m?.rating ?? ""} /></label>
      </div>
      <label className="field">Фото (https-ссылка на изображение в хранилище или CDN)<input name="photoUrl" type="url" maxLength={500} defaultValue={m?.photoUrl ?? ""} /></label>
      <label className="field">О мастере<input name="bio" maxLength={1000} defaultValue={m?.bio ?? ""} /></label>
      <fieldset className="checks">
        <legend>Какие услуги выполняет</legend>
        {services.map((s) => (
          <label className="check" key={s.id}>
            <input type="checkbox" name="services" value={s.id} defaultChecked={m?.serviceIds.includes(s.id)} /> {s.name}
          </label>
        ))}
      </fieldset>
      {m && <label className="check"><input type="checkbox" name="active" defaultChecked={m.active} /> Принимает записи</label>}
      <div><button className="btn" type="submit">{m ? "Сохранить мастера" : "Добавить мастера"}</button></div>
    </form>
  );
}

export default async function MastersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("masters");
  const sp = await searchParams;
  const [masters, services] = await Promise.all([
    prisma.master.findMany({ orderBy: { name: "asc" }, include: { services: { select: { serviceId: true } } } }),
    prisma.service.findMany({ where: { isAddon: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <h1>Мастера</h1>
      <p className="sub">График работы и отпуска настраиваются в разделе «Расписание».</p>
      <Notice code={sp.msg} />
      {masters.map((m) => (
        <details className="edit panel" key={m.id}>
          <summary>
            <b>{m.name}</b>{m.specialization ? ` — ${m.specialization}` : ""}{!m.active && " · не принимает записи"}
          </summary>
          <MasterForm services={services} m={{ ...m, serviceIds: m.services.map((x) => x.serviceId) }} />
        </details>
      ))}
      <section className="panel">
        <h2>Новый мастер</h2>
        <MasterForm services={services} />
      </section>
    </>
  );
}
