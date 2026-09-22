import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { ROLE_LABEL } from "@/lib/admin/permissions";
import { prisma } from "@/lib/db/prisma";
import { Notice } from "../notice";
import { createStaff, resetPassword, revokeSessions, updateStaff } from "./actions";

export const dynamic = "force-dynamic";

const EXTRA = {
  weak: { cls: "err", text: "Пароль должен быть не короче 12 символов." },
  exists: { cls: "err", text: "Сотрудник с таким email уже есть." },
  nomaster: { cls: "err", text: "Для роли «Мастер» выберите мастера." },
  self: { cls: "err", text: "Нельзя отключить или понизить самого себя." },
  last_owner: { cls: "err", text: "Нельзя отключить или понизить последнего владельца: панель осталась бы без управления." },
  pwd: { cls: "ok", text: "Пароль изменён, все сессии сотрудника завершены. Передайте новый пароль безопасным способом." },
  revoked: { cls: "ok", text: "Все сессии сотрудника завершены." },
};

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { admin: me } = await requireAdmin("admins");
  const sp = await searchParams;
  const [staff, masters] = await Promise.all([
    prisma.admin.findMany({ orderBy: { email: "asc" } }),
    prisma.master.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const roles = Object.entries(ROLE_LABEL);

  return (
    <>
      <h1>Сотрудники</h1>
      <p className="sub">Кто имеет доступ к панели. Владелец видит всё, администратор — записи, клиентов, расписание, услуги и акции, мастер — только свои записи.</p>
      <Notice code={sp.msg} extra={EXTRA} />

      {staff.map((s) => (
        <details className="edit panel" key={s.id}>
          <summary>
            <b>{s.email}</b> — {ROLE_LABEL[s.role]}{!s.active && " · отключён"}{s.id === me.id && " · это вы"}
          </summary>
          <form action={updateStaff} className="stack">
            <CsrfField />
            <input type="hidden" name="id" value={s.id} />
            <div className="cols">
              <label className="field">Роль
                <select name="role" defaultValue={s.role}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
              <label className="field">Мастер (для роли «Мастер»)
                <select name="masterId" defaultValue={s.masterId ?? ""}>
                  <option value="">—</option>
                  {masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field">MAX ID для уведомлений<input name="maxUserId" inputMode="numeric" maxLength={15} defaultValue={s.maxUserId?.toString() ?? ""} /></label>
            </div>
            <label className="check"><input type="checkbox" name="active" defaultChecked={s.active} /> Доступ разрешён</label>
            <div><button className="btn" type="submit">Сохранить</button></div>
          </form>
          <div className="cols" style={{ marginTop: 14 }}>
            <form action={resetPassword} className="rowform">
              <CsrfField />
              <input type="hidden" name="id" value={s.id} />
              <input type="password" name="password" placeholder="Новый пароль (от 12 символов)" minLength={12} maxLength={128} required autoComplete="new-password" />
              <button className="btn small ghost" type="submit">Сменить пароль</button>
            </form>
            <form action={revokeSessions}>
              <CsrfField />
              <input type="hidden" name="id" value={s.id} />
              <button className="btn small ghost" type="submit">Завершить все сессии</button>
            </form>
          </div>
        </details>
      ))}

      <section className="panel">
        <h2>Новый сотрудник</h2>
        <form action={createStaff} className="stack">
          <CsrfField />
          <div className="cols">
            <label className="field">Email<input type="email" name="email" required maxLength={254} autoComplete="off" /></label>
            <label className="field">Роль
              <select name="role" defaultValue="ADMIN">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="field">Мастер (для роли «Мастер»)
              <select name="masterId" defaultValue=""><option value="">—</option>{masters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
            </label>
            <label className="field">Пароль (от 12 символов)<input type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>
          </div>
          <div><button className="btn" type="submit">Добавить сотрудника</button></div>
        </form>
      </section>
    </>
  );
}
