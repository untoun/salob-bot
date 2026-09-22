import { PrismaClient } from "@prisma/client";

// Один клиент на инстанс функции (переиспользуется между вызовами и HMR).
// Для serverless DATABASE_URL должен указывать на pooled-хост Neon (-pooler),
// а миграции идут через DIRECT_URL.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
