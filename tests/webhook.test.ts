import { describe, it, expect, vi, beforeEach } from "vitest";

const { handleUpdate, claimEvent, markEvent } = vi.hoisted(() => ({
  handleUpdate: vi.fn(),
  claimEvent: vi.fn(),
  markEvent: vi.fn(),
}));

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/lib/bot/router", () => ({ handleUpdate }));
vi.mock("@/lib/max/webhook", () => ({ claimEvent, markEvent }));

const SECRET = "test_secret_1";

function req(body: unknown, secret: string | null = SECRET) {
  return new Request("https://x.test/api/max/webhook", {
    method: "POST",
    headers: secret ? { "x-max-bot-api-secret": secret } : {},
    body: JSON.stringify(body),
  });
}

describe("POST /api/max/webhook", () => {
  beforeEach(() => {
    process.env.MAX_WEBHOOK_SECRET = SECRET;
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.CRON_SECRET = "c".repeat(16);
    process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
    handleUpdate.mockReset().mockResolvedValue(undefined);
    claimEvent.mockReset();
    markEvent.mockReset().mockResolvedValue(undefined);
  });

  it("rejects wrong or missing secret", async () => {
    const { POST } = await import("@/app/api/max/webhook/route");
    expect((await POST(req({ update_type: "bot_started" }, "wrong_secret"))).status).toBe(401);
    expect((await POST(req({ update_type: "bot_started" }, null))).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("processes a new event once and returns 200", async () => {
    claimEvent.mockResolvedValue(true);
    const { POST } = await import("@/app/api/max/webhook/route");
    const res = await POST(req({ update_type: "message_created", message: { body: { mid: "m1" } } }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(handleUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips duplicates (idempotency)", async () => {
    claimEvent.mockResolvedValue(false);
    const { POST } = await import("@/app/api/max/webhook/route");
    const res = await POST(req({ update_type: "message_created", message: { body: { mid: "m1" } } }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it("returns 503 when DB is down so MAX retries", async () => {
    claimEvent.mockRejectedValue(new Error("db down"));
    const { POST } = await import("@/app/api/max/webhook/route");
    expect((await POST(req({ update_type: "bot_started", user: { user_id: 1 }, timestamp: 1 }))).status).toBe(503);
  });
});
