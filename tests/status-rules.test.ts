import { describe, it, expect } from "vitest";
import { canTransition } from "@/lib/booking/status-rules";
import { parseIntStrict, parseYesNo, STATUS_RU, statusFromRu } from "@/lib/google/labels";

describe("canTransition", () => {
  it("live -> cancel/complete/no-show/confirm", () => {
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "COMPLETED")).toBe(true);
    expect(canTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(canTransition("NEW", "CONFIRMED")).toBe(true);
  });
  it("final statuses cannot be revived (slot may be taken)", () => {
    expect(canTransition("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransition("COMPLETED", "CONFIRMED")).toBe(false);
    expect(canTransition("RESCHEDULED", "CONFIRMED")).toBe(false);
  });
  it("RESCHEDULED can only be set by the system", () => {
    expect(canTransition("CONFIRMED", "RESCHEDULED")).toBe(false);
  });
  it("same status and downgrade are rejected", () => {
    expect(canTransition("CONFIRMED", "CONFIRMED")).toBe(false);
    expect(canTransition("CONFIRMED", "NEW")).toBe(false);
  });
});

describe("labels", () => {
  it("status labels roundtrip", () => {
    for (const [k, v] of Object.entries(STATUS_RU)) expect(statusFromRu(v)).toBe(k);
    expect(statusFromRu("  ОТМЕНЕНА ")).toBe("CANCELLED");
    expect(statusFromRu("что-то")).toBeNull();
  });
  it("parsers", () => {
    expect(parseIntStrict("1 500 ₽")).toBe(1500);
    expect(parseIntStrict("-5")).toBeNull();
    expect(parseIntStrict("abc")).toBeNull();
    expect(parseYesNo("Да")).toBe(true);
    expect(parseYesNo("нет")).toBe(false);
    expect(parseYesNo("возможно")).toBeNull();
  });
});
