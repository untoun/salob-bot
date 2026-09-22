// Без зависимостей от env()/Prisma: используется и в middleware (Edge), и на сервере.
import { jwtVerify, SignJWT } from "jose";

export const SESSION_TTL_SEC = 8 * 60 * 60;

export const COOKIE_NAME = process.env.NODE_ENV === "production" ? "__Host-admin_session" : "admin_session";

export interface SessionClaims {
  sub: string; // Admin.id
  ver: number; // Admin.tokenVersion
  csrf: string;
}

const enc = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(secret: string, claims: SessionClaims, ttlSec = SESSION_TTL_SEC): Promise<string> {
  return new SignJWT({ ver: claims.ver, csrf: claims.csrf })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(enc(secret));
}

export async function verifySession(secret: string, token: string | undefined): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, enc(secret), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.ver !== "number" || typeof payload.csrf !== "string") return null;
    return { sub: payload.sub, ver: payload.ver, csrf: payload.csrf };
  } catch {
    return null; // просрочен, подделан, неверная подпись
  }
}
