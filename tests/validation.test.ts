import { describe, it, expect } from "vitest";
import { normalizePhone, validateName } from "@/lib/utils/validation";

describe("normalizePhone", () => {
  it.each([
    ["+7 (912) 345-67-89", "+79123456789"],
    ["8 912 345 67 89", "+79123456789"],
    ["79123456789", "+79123456789"],
    ["9123456789", "+79123456789"],
    ["+375 29 123 45 67", "+375291234567"],
  ])("%s -> %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "abc", "12345", "+7912345678", "+791234567890", "8 912 345 67", "1".repeat(40)])("rejects %s", (x) =>
    expect(normalizePhone(x)).toBeNull(),
  );
});

describe("validateName", () => {
  it("accepts normal names", () => {
    expect(validateName("  Мария  ")).toBe("Мария");
    expect(validateName("Анна-Мария")).toBe("Анна-Мария");
  });
  it("rejects garbage", () => {
    expect(validateName("A")).toBeNull();
    expect(validateName("<script>")).toBeNull();
    expect(validateName("Мария'; DROP")).toBeNull();
    expect(validateName("x".repeat(80))).toBeNull();
  });
});
