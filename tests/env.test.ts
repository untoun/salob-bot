import { describe, it, expect, beforeEach } from "vitest";

describe("maxBotToken", () => {
  beforeEach(() => {
    process.env.MAX_WEBHOOK_SECRET = "test_secret_1";
    process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
    process.env.CRON_SECRET = "c".repeat(16);
    process.env.ADMIN_SESSION_SECRET = "s".repeat(32);
  });

  it("uses PROD token only in production", async () => {
    process.env.MAX_BOT_TOKEN_PROD = "prod";
    process.env.MAX_BOT_TOKEN_DEV = "dev";
    process.env.VERCEL_ENV = "preview";
    const { maxBotToken } = await import("@/lib/config/env");
    expect(maxBotToken()).toBe("dev");
  });
});
