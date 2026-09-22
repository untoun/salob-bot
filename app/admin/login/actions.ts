"use server";

import { redirect } from "next/navigation";
import { authenticate, clientIp, endSession, startSession, authorizeAction } from "@/lib/admin/auth";

function safeNext(v: FormDataEntryValue | null): string {
  return typeof v === "string" && /^\/admin(\/[\w\-/]*)?(\?[\w=&%.\-+]*)?$/.test(v) && !v.startsWith("//") ? v : "/admin";
}

export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  const result = await authenticate(email, password, await clientIp());
  if (!result.ok) redirect(`/admin/login?error=${result.reason}${next !== "/admin" ? `&next=${encodeURIComponent(next)}` : ""}`);
  await startSession(result.admin);
  redirect(next);
}

export async function logout(formData: FormData): Promise<void> {
  await authorizeAction("dashboard", formData);
  await endSession();
  redirect("/admin/login");
}
