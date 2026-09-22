import { describe, it, expect } from "vitest";
import { computeSlotMinutes, resolveDayWindow } from "@/lib/booking/slots";

const h = (x: number) => x * 60;

describe("computeSlotMinutes", () => {
  const base = { startMin: h(9), endMin: h(18), durationMin: 60, stepMin: 30 };

  it("respects the end of the working day", () => {
    const s = computeSlotMinutes({ ...base, busy: [] });
    expect(s[0]).toBe(h(9));
    expect(s.at(-1)).toBe(h(17)); // 17:00 + 60 = 18:00
    expect(s).not.toContain(h(17) + 30);
  });

  it("excludes breaks and overlapping bookings", () => {
    const s = computeSlotMinutes({ ...base, busy: [{ startMin: h(13), endMin: h(14) }, { startMin: h(10), endMin: h(11) }] });
    expect(s).not.toContain(h(13)); // внутри перерыва
    expect(s).not.toContain(h(12) + 30); // 12:30-13:30 пересекает перерыв
    expect(s).not.toContain(h(9) + 30); // 9:30-10:30 пересекает запись
    expect(s).toContain(h(9)); // 9:00-10:00 вплотную к записи — можно
    expect(s).toContain(h(11)); // сразу после записи
    expect(s).toContain(h(14));
  });

  it("longer service needs a longer gap", () => {
    const busy = [{ startMin: h(11), endMin: h(12) }];
    expect(computeSlotMinutes({ ...base, durationMin: 120, busy })).not.toContain(h(10));
    expect(computeSlotMinutes({ ...base, durationMin: 60, busy })).toContain(h(10));
  });

  it("drops slots earlier than the lead time", () => {
    const s = computeSlotMinutes({ ...base, busy: [], earliestMin: h(12) });
    expect(s[0]).toBe(h(12));
  });
});

describe("resolveDayWindow", () => {
  const weekly = { startMin: h(9), endMin: h(18), breakStartMin: h(13), breakEndMin: h(14) };

  it("no weekly row means day off", () => expect(resolveDayWindow(null, [])).toBeNull());
  it("vacation / day off exceptions close the day", () => {
    expect(resolveDayWindow(weekly, [{ type: "VACATION" }])).toBeNull();
    expect(resolveDayWindow(weekly, [{ type: "DAY_OFF" }])).toBeNull();
  });
  it("custom hours override, extra breaks add up", () => {
    const w = resolveDayWindow(weekly, [{ type: "CUSTOM_HOURS", startMin: h(10), endMin: h(15) }, { type: "BREAK", startMin: h(11), endMin: h(12) }]);
    expect(w).toMatchObject({ startMin: h(10), endMin: h(15) });
    expect(w?.breaks).toHaveLength(2);
  });
});
