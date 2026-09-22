import { describe, it, expect, vi } from "vitest";
import { log, maskPhone } from "@/lib/logging/logger";

describe("logger", () => {
  it("redacts secrets", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "x", { botToken: "abc", nested: { password: "p", ok: 1 } });
    const out = String(spy.mock.calls[0]?.[0]);
    expect(out).not.toContain("abc");
    expect(out).not.toContain('"p"');
    expect(out).toContain('"ok":1');
    spy.mockRestore();
  });
  it("masks phones", () => {
    expect(maskPhone("+79991234567")).toBe("+79****4567");
  });
});
