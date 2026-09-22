import { redirect } from "next/navigation";
import { getAdminContext } from "@/lib/admin/auth";
import { login } from "./actions";

const MESSAGES: Record<string, string> = {
  invalid: "Неверный email или пароль.",
  rate: "Слишком много попыток входа. Подождите 15 минут и попробуйте снова.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (await getAdminContext()) redirect("/admin");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? MESSAGES[sp.error] : undefined;
  const next = typeof sp.next === "string" ? sp.next : "";

  return (
    <main className="login">
      <form action={login}>
        <div>
          <h1>Вход в панель салона</h1>
          <p>Для сотрудников. Записи, клиенты и расписание.</p>
        </div>
        {error && (
          <div className="notice err" role="alert">
            {error}
          </div>
        )}
        <input type="hidden" name="next" value={next} />
        <label className="field">
          Email
          <input name="email" type="email" autoComplete="username" required maxLength={254} />
        </label>
        <label className="field">
          Пароль
          <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
        </label>
        <button className="btn" type="submit">
          Войти
        </button>
      </form>
    </main>
  );
}
