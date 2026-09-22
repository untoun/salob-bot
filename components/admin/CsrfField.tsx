import { getAdminContext } from "@/lib/admin/auth";

/** Скрытое поле с CSRF-токеном сессии для форм с server actions */
export async function CsrfField() {
  const ctx = await getAdminContext();
  return <input type="hidden" name="_csrf" value={ctx?.csrf ?? ""} />;
}
