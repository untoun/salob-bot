import { beforeEach, describe, expect, it, vi } from "vitest";

const { notification, sendMessage } = vi.hoisted(() => ({
  notification: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  sendMessage: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: { notification } }));
vi.mock("@/lib/max/client", () => ({
  sendMessage,
  MaxApiError: class MaxApiError extends Error {
    constructor(public status: number, m: string, public retryable: boolean) {
      super(m);
    }
  },
}));

const H = 3_600_000;

function row(over: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 23 * H);
  return {
    id: "n1",
    type: "REMINDER_24H",
    status: "PENDING",
    attempts: 0,
    scheduledAt: new Date(Date.now() - 60_000),
    booking: { id: "b1", status: "CONFIRMED", startsAt, service: { name: "Стрижка" }, master: { name: "Анна" } },
    user: { maxUserId: 123n, blockedBot: false },
    ...over,
  };
}

const statusOf = () => notification.update.mock.calls.map((c) => c[0].data.status);

describe("processDueNotifications", () => {
  beforeEach(() => {
    process.env.MAX_WEBHOOK_SECRET = "test_secret_1";
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.CRON_SECRET = "c".repeat(16);
    process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
    notification.findMany.mockReset();
    notification.updateMany.mockReset().mockResolvedValue({ count: 1 });
    notification.update.mockReset().mockResolvedValue({});
    sendMessage.mockReset().mockResolvedValue({});
  });

  it("sends a due reminder once and marks it SENT", async () => {
    notification.findMany.mockResolvedValue([row()]);
    const { processDueNotifications } = await import("@/lib/notifications/sender");
    const r = await processDueNotifications();
    expect(r.sent).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(statusOf()).toEqual(["SENT"]);
  });

  it("does not send when another cron run already claimed it", async () => {
    notification.findMany.mockResolvedValue([row()]);
    notification.updateMany.mockResolvedValue({ count: 0 });
    const { processDueNotifications } = await import("@/lib/notifications/sender");
    const r = await processDueNotifications();
    expect(r.lost).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("skips reminders for cancelled bookings", async () => {
    notification.findMany.mockResolvedValue([row({ booking: { ...row().booking, status: "CANCELLED" } })]);
    const { processDueNotifications } = await import("@/lib/notifications/sender");
    const r = await processDueNotifications();
    expect(r.skipped).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(statusOf()).toEqual(["SKIPPED"]);
  });

  it("skips users who blocked the bot", async () => {
    notification.findMany.mockResolvedValue([row({ user: { maxUserId: 1n, blockedBot: true } })]);
    const { processDueNotifications } = await import("@/lib/notifications/sender");
    expect((await processDueNotifications()).skipped).toBe(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("temporary MAX failure keeps it PENDING (retry), permanent 4xx marks FAILED", async () => {
    const { MaxApiError } = await import("@/lib/max/client");
    const { processDueNotifications } = await import("@/lib/notifications/sender");

    notification.findMany.mockResolvedValue([row()]);
    sendMessage.mockRejectedValueOnce(new MaxApiError(503, "down", true));
    expect((await processDueNotifications()).retry).toBe(1);
    expect(statusOf()).not.toContain("FAILED");

    notification.update.mockClear();
    notification.findMany.mockResolvedValue([row()]);
    sendMessage.mockRejectedValueOnce(new MaxApiError(403, "blocked", false));
    expect((await processDueNotifications()).failed).toBe(1);
    expect(statusOf()).toEqual(["FAILED"]);
  });
});
