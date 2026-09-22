import { describe, it, expect, beforeAll } from "vitest";
import { can, bookingScope } from "@/lib/admin/permissions";
import { signSession, verifySession } from "@/lib/admin/session-token";
import { normalizeEmail, validatePassword } from "@/lib/admin/password";
import { safeBackPath } from "@/lib/admin/bookings-query";

const SECRET = "x".repeat(40);

describe("RBAC matrix", () => {
  it("SUPER_ADMIN can do everything", () => {
    for (const p of ["logs", "settings", "admins", "sheets", "bookings:write", "masters"] as const) expect(can("SUPER_ADMIN", p)).toBe(true);
  });
  it("ADMIN: bookings, clients, schedule, services, promos — but not settings/logs/admins/sheets/masters", () => {
    for (const p of ["bookings:read", "bookings:write", "clients", "schedule", "services", "promos"] as const) expect(can("ADMIN", p)).toBe(true);
    for (const p of ["settings", "logs", "admins", "sheets", "masters"] as const) expect(can("ADMIN", p)).toBe(false);
  });
  it("MASTER: read-only own schedule/bookings, no clients, no writes", () => {
    expect(can("MASTER", "bookings:read")).toBe(true);
    expect(can("MASTER", "calendar")).toBe(true);
    for (const p of ["bookings:write", "clients", "services", "promos", "logs", "admins"] as const) expect(can("MASTER", p)).toBe(false);
  });
  it("master scope always pins masterId; unlinked master sees nothing", () => {
    expect(bookingScope({ role: "MASTER", masterId: "m1" })).toEqual({ masterId: "m1" });
    expect(bookingScope({ role: "MASTER", masterId: null }).masterId).toBe("__no_master__");
    expect(bookingScope({ role: "ADMIN", masterId: null })).toEqual({});
  });
});

describe("session token", () => {
  const claims = { sub: "adm_123456", ver: 3, csrf: "abc" };
  it("roundtrips", async () => {
    expect(await verifySession(SECRET, await signSession(SECRET, claims))).toEqual(claims);
  });
  it("rejects wrong secret, tampering, garbage and expiry", async () => {
    const t = await signSession(SECRET, claims);
    expect(await verifySession("y".repeat(40), t)).toBeNull();
    expect(await verifySession(SECRET, t.slice(0, -3) + "abc")).toBeNull();
    expect(await verifySession(SECRET, "not.a.jwt")).toBeNull();
    expect(await verifySession(SECRET, undefined)).toBeNull();
    const shortLived = await signSession(SECRET, claims, 1);
    expect(await verifySession(SECRET, shortLived)).toEqual(claims);
    await new Promise((r) => setTimeout(r, 2100));
    expect(await verifySession(SECRET, shortLived)).toBeNull(); // срок истёк
  });
  it("rejects alg=none forgery", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "adm_123456", ver: 3, csrf: "abc", exp: 9999999999 })}.`;
    expect(await verifySession(SECRET, forged)).toBeNull();
  });
});

describe("password & email policy", () => {
  it("enforces length and rejects trivial passwords", () => {
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("aaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(validatePassword("x".repeat(200))).not.toBeNull();
    expect(validatePassword("correct horse battery")).toBeNull();
  });
  it("normalizes emails", () => {
    expect(normalizeEmail("  Admin@Example.COM ")).toBe("admin@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizeEmail("a b@c.d")).toBeNull();
  });
});

describe("open-redirect guard", () => {
  beforeAll(() => {
    process.env.SALON_TIMEZONE = "Asia/Yekaterinburg";
  });
  it("only allows local bookings paths", () => {
    expect(safeBackPath("/admin/bookings?from=2026-09-20&page=2")).toBe("/admin/bookings?from=2026-09-20&page=2");
    expect(safeBackPath("https://evil.example")).toBe("/admin/bookings");
    expect(safeBackPath("//evil.example")).toBe("/admin/bookings");
    expect(safeBackPath("/admin/other")).toBe("/admin/bookings");
    expect(safeBackPath(null)).toBe("/admin/bookings");
  });
});
