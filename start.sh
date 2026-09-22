#!/bin/sh
set -e

echo "==> Применяю миграции Prisma (prisma migrate deploy)..."
npx prisma migrate deploy

echo "==> Запускаю Next.js на 0.0.0.0:${PORT:-3000}..."
exec npx next start -p "${PORT:-3000}" -H 0.0.0.0
