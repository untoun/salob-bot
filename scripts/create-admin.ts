/**
 * Создаёт (или обновляет пароль) владельца панели.
 * Запуск: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create
 * Пароль хранится только в виде bcrypt-хеша и нигде не печатается.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { normalizeEmail, validatePassword } from "@/lib/admin/password";

async function main() {
  const email = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) throw new Error("ADMIN_EMAIL не задан или некорректен");
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.admin.upsert({
      where: { email },
      create: { email, passwordHash, role: "SUPER_ADMIN" },
      update: { passwordHash, active: true, tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
    });
    console.log(`Готово: ${admin.email} (${admin.role}). Удалите ADMIN_PASSWORD из окружения.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
