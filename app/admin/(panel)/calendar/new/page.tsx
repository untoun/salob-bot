import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { ID_RE } from "@/lib/admin/forms";
import { getSlotsForMasters } from "@/lib/booking/availability";
import { prisma } from "@/lib/db/prisma";
import { formatDuration } from "@/lib/utils/format";
import { formatDateRu, isValidDateISO, minutesToHHmm, nowLocal } from "@/lib/utils/time";
import { Notice } from "../../notice";
import { createAdminBooking } from "./actions";

export const dynamic = "force-dynamic";
const EXTRA = {
  taken: { cls: "warn", text: "Это время только что заняли. Выберите другое." },
  badclient: { cls: "err", text: "Проверьте имя (буквами) и телефон (например, +7 912 345-67-89)." },
};
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("bookings:write");
  const sp = await searchParams;
  const today = nowLocal().toISODate()!;

  const moveId = one(sp.move) && ID_RE.test(one(sp.move)!) ? one(sp.move)! : undefined;
  const moving = moveId
    ? await prisma.booking.findFirst({ where: { id: moveId, status: { in: ["NEW", "CONFIRMED"] } }, include: { client: true, service: true, master: true } })
    : null;

  const serviceId = moving ? moving.serviceId : one(sp.service) && ID_RE.test(one(sp.service)!) ? one(sp.service)! : undefined;
  const masterSel = one(sp.master) === "any" ? "any" : one(sp.master) && ID_RE.test(one(sp.master)!) ? one(sp.master)! : moving?.masterId;
  const dateRaw = one(sp.date);
  const date = dateRaw && isValidDateISO(dateRaw) && dateRaw >= today ? dateRaw : undefined;

  const [services, masters] = await Promise.all([
    prisma.service.findMany({ where: { active: true, isAddon: false }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.master.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  let slots: number[] = [];
  let duration = 0;
  let serviceName = "";
  if (serviceId && masterSel && date) {
    const svc = await prisma.service.findFirst({ where: { id: serviceId, active: true } });
    const addon = moving?.addonServiceIds[0] ? await prisma.service.findUnique({ where: { id: moving.addonServiceIds[0] } }) : null;
    if (svc) {
      serviceName = svc.name;
      duration = svc.durationMin + (addon?.durationMin ?? 0);
      const ids =
        masterSel === "any"
          ? (await prisma.master.findMany({ where: { active: true, services: { some: { serviceId: svc.id } } }, select: { id: true } })).map((m) => m.id)
          : [masterSel];
      slots = await getSlotsForMasters(ids, date, duration, moveId);
    }
  }

  return (
    <>
      <h1>{moving ? "Перенос записи" : "Новая запись"}</h1>
      <p className="sub">
        {moving ? `${moving.client.name} · ${moving.service.name}. Выберите новую дату и время.` : "Создайте запись за клиента, например по телефонному звонку. Занять чужое время нельзя: слоты считаются так же, как в боте."}
      </p>
      <Notice code={sp.msg} extra={EXTRA} />

      <form className="panel filters" method="get">
        {moveId && <input type="hidden" name="move" value={moveId} />}
        {!moving && (
          <label className="field">Услуга
            <select name="service" required defaultValue={serviceId ?? ""}>
              <option value="" disabled>Выберите</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">Мастер
          <select name="master" required defaultValue={masterSel ?? "any"}>
            <option value="any">Любой</option>
            {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field">Дата<input type="date" name="date" min={today} required defaultValue={date} /></label>
        <button className="btn ghost" type="submit">Показать время</button>
      </form>

      {serviceId && masterSel && date && (
        <section className="panel">
          <h2>{serviceName} · {formatDateRu(date)} · {formatDuration(duration)}</h2>
          {slots.length === 0 ? (
            <p className="empty">На эту дату свободного времени нет. Выберите другую дату или мастера.</p>
          ) : (
            <form action={createAdminBooking} className="stack">
              <CsrfField />
              {moveId && <input type="hidden" name="move" value={moveId} />}
              <input type="hidden" name="service" value={serviceId} />
              <input type="hidden" name="master" value={masterSel} />
              <input type="hidden" name="date" value={date} />
              <label className="field">Время
                <select name="time" required>{slots.map((m) => <option key={m} value={m}>{minutesToHHmm(m)}</option>)}</select>
              </label>
              {!moving && (
                <div className="cols">
                  <label className="field">Имя клиента<input name="name" required maxLength={60} autoComplete="off" /></label>
                  <label className="field">Телефон<input name="phone" type="tel" required maxLength={30} placeholder="+7 912 345-67-89" autoComplete="off" /></label>
                </div>
              )}
              <div><button className="btn" type="submit">{moving ? "Перенести запись" : "Создать запись"}</button></div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
