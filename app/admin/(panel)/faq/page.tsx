import { CsrfField } from "@/components/admin/CsrfField";
import { requireAdmin } from "@/lib/admin/auth";
import { prisma } from "@/lib/db/prisma";
import { Notice } from "../notice";
import { deleteFaq, saveFaq } from "./actions";

export const dynamic = "force-dynamic";

type F = { id: string; question: string; answer: string; sortOrder: number; active: boolean };

function FaqForm({ f }: { f?: F }) {
  return (
    <form action={saveFaq} className="stack">
      <CsrfField />
      {f && <input type="hidden" name="id" value={f.id} />}
      <label className="field">Вопрос<input name="question" required maxLength={200} defaultValue={f?.question} /></label>
      <label className="field">Ответ<input name="answer" required maxLength={2000} defaultValue={f?.answer} /></label>
      <div className="cols">
        <label className="field">Порядок<input name="sortOrder" type="number" min={0} max={999} defaultValue={f?.sortOrder ?? 0} /></label>
        {f && <label className="check"><input type="checkbox" name="active" defaultChecked={f.active} /> Показывать клиентам</label>}
      </div>
      <div><button className="btn" type="submit">{f ? "Сохранить" : "Добавить вопрос"}</button></div>
    </form>
  );
}

export default async function FaqPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("faq");
  const sp = await searchParams;
  const items = await prisma.fAQ.findMany({ orderBy: [{ sortOrder: "asc" }, { question: "asc" }] });
  return (
    <>
      <h1>Частые вопросы</h1>
      <p className="sub">Эти ответы видят клиенты в боте, и на них опирается AI-помощник.</p>
      <Notice code={sp.msg} />
      {items.map((f) => (
        <details className="edit panel" key={f.id}>
          <summary><b>{f.question}</b>{!f.active && " · скрыт"}</summary>
          <FaqForm f={f} />
          <form action={deleteFaq} style={{ marginTop: 10 }}>
            <CsrfField />
            <input type="hidden" name="id" value={f.id} />
            <button className="btn small ghost" type="submit">Удалить</button>
          </form>
        </details>
      ))}
      <section className="panel">
        <h2>Новый вопрос</h2>
        <FaqForm />
      </section>
    </>
  );
}
