import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.MAX_WEBHOOK_SECRET = "test_secret_1";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.CRON_SECRET = "c".repeat(16);
  process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
  process.env.SALON_TIMEZONE = "Asia/Yekaterinburg";
});

describe("bookings filters", () => {
  it("sanitises hostile URL params", async () => {
    const { parseFilters } = await import("@/lib/admin/bookings-query");
    const f = parseFilters({ from: "2026-13-99", to: "'; DROP TABLE", status: "HACK", master: "../../etc", page: "-5", q: "x".repeat(500) });
    expect(f.status).toBeUndefined();
    expect(f.masterId).toBeUndefined();
    expect(f.page).toBe(1);
    expect(f.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.q?.length).toBe(60);
  });

  it("role scope overrides a master id from the URL", async () => {
    const { buildWhere, parseFilters } = await import("@/lib/admin/bookings-query");
    const f = parseFilters({ master: "othermaster1", from: "2026-09-21", to: "2026-09-27" });
    expect(buildWhere(f, { masterId: "mymaster001" }).masterId).toBe("mymaster001");
    expect(buildWhere(f, {}).masterId).toBe("othermaster1");
  });

  it("date range uses salon-local day boundaries in UTC", async () => {
    const { buildWhere, parseFilters } = await import("@/lib/admin/bookings-query");
    const w = buildWhere(parseFilters({ from: "2026-09-21", to: "2026-09-21" }), {});
    const range = w.startsAt as { gte: Date; lt: Date };
    expect(range.gte.toISOString()).toBe("2026-09-20T19:00:00.000Z"); // 00:00 Екатеринбурга
    expect(range.lt.toISOString()).toBe("2026-09-21T19:00:00.000Z");
  });
});
