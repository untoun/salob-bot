import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.MAX_WEBHOOK_SECRET = "test_secret_1";
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.CRON_SECRET = "c".repeat(16);
  process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
  process.env.SALON_TIMEZONE = "Asia/Yekaterinburg";
});

describe("time helpers (Asia/Yekaterinburg = UTC+5)", () => {
  it("converts local salon time to UTC", async () => {
    const { toUtc, dayStartUtc } = await import("@/lib/utils/time");
    expect(toUtc("2026-09-25", 15 * 60).toISOString()).toBe("2026-09-25T10:00:00.000Z");
    expect(dayStartUtc("2026-09-25").toISOString()).toBe("2026-09-24T19:00:00.000Z");
  });
  it("weekday is ISO (Mon=1)", async () => {
    const { weekdayOf } = await import("@/lib/utils/time");
    expect(weekdayOf("2026-09-21")).toBe(1); // понедельник
    expect(weekdayOf("2026-09-27")).toBe(7);
  });
  it("formats Russian dates in genitive", async () => {
    const { formatDateRu, formatTimeLocal } = await import("@/lib/utils/time");
    expect(formatDateRu("2026-09-25")).toBe("25 сентября");
    expect(formatTimeLocal(new Date("2026-09-25T10:00:00Z"))).toBe("15:00");
  });
});
