import { describe, it, expect } from "vitest";
import { formatDuration, formatPrice } from "@/lib/utils/format";

describe("format", () => {
  it("prices", () => {
    expect(formatPrice(1500)).toBe("1 500 ₽");
    expect(formatPrice(3500, true)).toBe("от 3 500 ₽");
  });
  it("durations", () => {
    expect(formatDuration(45)).toBe("45 мин");
    expect(formatDuration(60)).toBe("1 ч");
    expect(formatDuration(90)).toBe("1 ч 30 мин");
  });
});
