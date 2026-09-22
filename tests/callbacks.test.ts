import { describe, it, expect } from "vitest";
import { cb, decode } from "@/lib/bot/callbacks";

describe("callback codec", () => {
  it("roundtrips", () => {
    expect(decode(cb.category("cmabc12345"))).toEqual({ kind: "category", id: "cmabc12345" });
    expect(decode(cb.service("cmabc12345"))).toEqual({ kind: "service", id: "cmabc12345" });
    expect(decode(cb.menu)).toEqual({ kind: "menu" });
    expect(decode(cb.planned("portfolio"))).toEqual({ kind: "planned", section: "portfolio" });
  });
  it("rejects garbage and injection", () => {
    expect(decode("svc:i:'; DROP TABLE--")).toBeNull();
    expect(decode("soon:hack")).toBeNull();
    expect(decode("x".repeat(500))).toBeNull();
    expect(decode(undefined)).toBeNull();
  });
});

describe("admin/ask callbacks", () => {
  it("decodes admin actions and ask", () => {
    expect(decode(cb.askAdmin)).toEqual({ kind: "askAdmin" });
    expect(decode(cb.admCancelAsk("cmabc12345"))).toEqual({ kind: "admCancelAsk", id: "cmabc12345" });
    expect(decode(cb.admCancelYes("cmabc12345"))).toEqual({ kind: "admCancelYes", id: "cmabc12345" });
    expect(decode(cb.admReply("cmabc12345"))).toEqual({ kind: "admReply", id: "cmabc12345" });
    expect(decode("adm:x")).toBeNull();
    expect(decode("adm:zz:cmabc12345")).toBeNull();
  });
});
