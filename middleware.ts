import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/admin/session-token";

// Первый рубеж: пропускаем в /admin только с валидной подписанной cookie.
// Настоящая авторизация (роль, активность, права) — на сервере при каждом запросе и действии.
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const secret = process.env.ADMIN_SESSION_SECRET ?? "";
  const claims = secret.length >= 32 ? await verifySession(secret, req.cookies.get(COOKIE_NAME)?.value) : null;
  if (!claims) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
