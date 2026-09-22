import { describe, it, expect } from "vitest";
import { deriveEventId } from "@/lib/max/events";
import { updateSchema } from "@/lib/max/types";

describe("deriveEventId", () => {
  it("uses mid for messages, callback_id for callbacks (stable across retries)", () => {
    const m = updateSchema.parse({ update_type: "message_created", message: { body: { mid: "abc" } } });
    const c = updateSchema.parse({ update_type: "message_callback", callback: { callback_id: "cb1" } });
    expect(deriveEventId(m, "h1")).toBe("msg:abc");
    expect(deriveEventId(c, "h2")).toBe("cb:cb1");
  });
  it("falls back to payload hash", () => {
    const u = updateSchema.parse({ update_type: "dialog_cleared" });
    expect(deriveEventId(u, "a".repeat(64))).toBe(`dialog_cleared:${"a".repeat(32)}`);
  });
});
