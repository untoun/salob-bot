#!/usr/bin/env bash
# Логический бэкап PostgreSQL (pg_dump). Запускайте по расписанию на СВОЕЙ машине/сервере,
# а не в GitHub Actions: дамп содержит персональные данные клиентов.
# Использование: DIRECT_URL=postgresql://... ./scripts/backup.sh [каталог]
set -euo pipefail
: "${DIRECT_URL:?Задайте DIRECT_URL (прямое подключение, не -pooler)}"
DIR="${1:-./backups}"
mkdir -p "$DIR"
FILE="$DIR/salon-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$DIRECT_URL"
chmod 600 "$FILE"
echo "Готово: $FILE"
echo "Храните копии в зашифрованном хранилище; восстановление: pg_restore --no-owner -d <новая_БД> $FILE"
