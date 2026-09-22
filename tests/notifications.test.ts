import { describe, it, expect } from "vitest";
import { buildNotificationText, dayLabel, isStale } from "@/lib/notifications/templates";

const zone = "Asia/Yekaterinburg";
// 2026-09-25 15:00 по Екатеринбургу = 10:00Z
const visit = new Date("2026-09-25T10:00:00Z");

describe("dayLabel", () => {
  it("today / tomorrow / date", () => {
    expect(dayLabel(visit, new Date("2026-09-25T02:00:00Z"), zone)).toBe("Сегодня");
    expect(dayLabel(visit, new Date("2026-09-24T09:00:00Z"), zone)).toBe("Завтра");
    expect(dayLabel(visit, new Date("2026-09-20T09:00:00Z"), zone)).toBe("25 сентября");
  });
  it("uses salon timezone around midnight", () => {
    // 2026-09-24 20:00Z = 25 сентября 01:00 в Екатеринбурге -> визит уже «Сегодня»
    expect(dayLabel(visit, new Date("2026-09-24T20:00:00Z"), zone)).toBe("Сегодня");
  });
});

describe("buildNotificationText", () => {
  const base = { serviceName: "Женская стрижка", masterName: "Анна", startsAt: visit, address: "ул. Ленина, 25", zone };
  it("24h reminder", () => {
    const t = buildNotificationText("REMINDER_24H", { ...base, now: new Date("2026-09-24T10:00:00Z") });
    expect(t).toContain("Завтра в 15:00");
    expect(t).toContain("Женская стрижка");
    expect(t).toContain("📍 ул. Ленина, 25");
    expect(t).toContain("До встречи!");
  });
  it("cancelled", () => {
    expect(buildNotificationText("BOOKING_CANCELLED", { ...base, now: new Date("2026-09-24T10:00:00Z") })).toContain("отменена");
  });
});

describe("isStale", () => {
  const H = 3_600_000;
  it("24h reminder is stale when visit is < 3h away or cron was down > 6h", () => {
    expect(isStale("REMINDER_24H", new Date(visit.getTime() - 24 * H), visit, new Date(visit.getTime() - 23 * H))).toBe(false);
    expect(isStale("REMINDER_24H", new Date(visit.getTime() - 24 * H), visit, new Date(visit.getTime() - 2 * H))).toBe(true);
    expect(isStale("REMINDER_24H", new Date(visit.getTime() - 24 * H), visit, new Date(visit.getTime() - 17 * H))).toBe(true);
  });
  it("2h reminder is stale right before / after the visit", () => {
    expect(isStale("REMINDER_2H", new Date(visit.getTime() - 2 * H), visit, new Date(visit.getTime() - 1.9 * H))).toBe(false);
    expect(isStale("REMINDER_2H", new Date(visit.getTime() - 2 * H), visit, new Date(visit.getTime() - 5 * 60_000))).toBe(true);
    expect(isStale("REMINDER_2H", new Date(visit.getTime() - 2 * H), visit, new Date(visit.getTime() + H))).toBe(true);
  });
});
