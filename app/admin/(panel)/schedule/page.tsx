import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { bookingScope, can } from "@/lib/admin/permissions";
import { prisma } from "@/lib/db/prisma";
import { minutesToHHmm, nowLocal } from "@/lib/utils/time";
import { Notice } from "../notice";
import { addException, deleteException, saveWeek } from "./actions";

export const dynamic = "force-dynamic";

const DAYS = ["", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const TYPE_RU: Record<string, string> = { DAY_OFF: "Выходной", VACATION: "Отпуск", BREAK: "Доп. перерыв", CUSTOM_HOURS: "Особые часы" };
const EXTRA = {
  past: { cls: "err", text: "Нельзя добавлять исключения на прошедшие даты." },
  bad_time: { cls: "err", text: "Время указано неверно (формат ЧЧ:ММ)." },
  bad_range: { cls: "err", text: "Конец рабочего дня должен быть позже начала минимум на 30 минут." },
  bad_break: { cls: "err", text: "Перерыв должен быть внутри рабочего времени, начало раньше конца." },
};

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin } = await requireAdmin("schedule");
  const sp = await searchParams;
  const scope = bookingScope(admin);
  const canWrite = can(admin.role, "schedule:write");
  const today = nowLocal().toISODate()!;

  const masters = await prisma.master.findMany({
    where: { active: true, ...(scope.masterId ? { id: scope.masterId } : {}) },
    orderBy: { name: "asc" },
    include: { schedules: true, exceptions: { where: { date: { gte: new Date(`${today}T00:00:00Z`) } }, orderBy: { date: "asc" } } },
  });

  const msg = typeof sp.msg === "string" ? sp.msg : "";
  const conflict = /^conflict_(\d+)$/.exec(msg);

  return (
    <>
      <h1>Расписание</h1>
      <p className="sub">Недельный график и исключения (выходные, отпуска). Клиенты видят только свободное время внутри рабочих часов.</p>
      {conflict ? (
        <div className="notice warn" role="status">
          Исключение добавлено, но на эту дату уже есть записей: {conflict[1]}. Они не отменены — перенесите их или свяжитесь с клиентами.
        </div>
      ) : (
        <Notice code={msg} extra={EXTRA} />
      )}

      {masters.length === 0 && <p className="empty">Нет активных мастеров.</p>}
      {masters.map((m) => {
        const by = new Map(m.schedules.map((s) => [s.weekday, s]));
        return (
          <section className="panel" key={m.id}>
            <h2>{m.name}</h2>
            <form action={saveWeek}>
              <CsrfField />
              <input type="hidden" name="masterId" value={m.id} />
              <div className="table-wrap">
                <table className="t" style={{ minWidth: 640 }}>
                  <thead>
                    <tr><th>День</th><th>Работает</th><th>С</th><th>До</th><th>Перерыв с</th><th>до</th></tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                      const s = by.get(d);
                      const t = (v: number | null | undefined) => (v == null ? "" : minutesToHHmm(v));
                      return (
                        <tr key={d}>
                          <td>{DAYS[d]}</td>
                          <td><input type="checkbox" name={`d${d}_on`} defaultChecked={!!s} disabled={!canWrite} aria-label={`${DAYS[d]}: работает`} /></td>
                          <td><input type="time" name={`d${d}_start`} defaultValue={t(s?.startMin) || "09:00"} disabled={!canWrite} /></td>
                          <td><input type="time" name={`d${d}_end`} defaultValue={t(s?.endMin) || "18:00"} disabled={!canWrite} /></td>
                          <td><input type="time" name={`d${d}_bs`} defaultValue={t(s?.breakStartMin)} disabled={!canWrite} /></td>
                          <td><input type="time" name={`d${d}_be`} defaultValue={t(s?.breakEndMin)} disabled={!canWrite} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canWrite && <p><button className="btn" type="submit">Сохранить график</button></p>}
            </form>

            <h2 style={{ marginTop: 22 }}>Выходные, отпуска и особые часы</h2>
            {m.exceptions.length === 0 ? (
              <p className="empty">Исключений на будущие даты нет.</p>
            ) : (
              <ul className="rank">
                {m.exceptions.map((e) => (
                  <li key={e.id}>
                    <span>
                      {e.date.toISOString().slice(0, 10)} — {TYPE_RU[e.type]}
                      {e.startMin != null && e.endMin != null ? ` ${minutesToHHmm(e.startMin)}–${minutesToHHmm(e.endMin)}` : ""}
                      {e.note ? ` · ${e.note}` : ""}
                    </span>
                    {canWrite && (
                      <form action={deleteException}>
                        <CsrfField />
                        <input type="hidden" name="id" value={e.id} />
                        <button className="btn small ghost" type="submit">Удалить</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <form action={addException} className="cols" style={{ marginTop: 12 }}>
                <CsrfField />
                <input type="hidden" name="masterId" value={m.id} />
                <label className="field">Дата<input type="date" name="date" min={today} required /></label>
                <label className="field">Что
                  <select name="type" defaultValue="DAY_OFF">
                    {Object.entries(TYPE_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">С<input type="time" name="start" /></label>
                <label className="field">До<input type="time" name="end" /></label>
                <label className="field">Заметка<input name="note" maxLength={200} /></label>
                <button className="btn" type="submit">Добавить</button>
              </form>
            )}
          </section>
        );
      })}
    </>
  );
}
