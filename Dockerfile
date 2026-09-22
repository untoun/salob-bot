# =============================================================
#  Dockerfile под Bothost.ru
# =============================================================
# ВАЖНО (см. bothost.ru/docs/common-errors): при запуске контейнера
# Bothost монтирует каталог /app с исходниками из Git поверх образа.
# Next.js кладёт сборку в `.next` внутри рабочей папки — если собирать
# в /app, эта папка будет скрыта bind mount'ом и контейнер упадёт с
# MODULE_NOT_FOUND / "Cannot find module '.next/...'".
#
# Поэтому вся сборка идёт в /usr/src/app (вне /app), а сам /app
# вообще не используется приложением — персистентных файлов на диске
# у бота нет, всё состояние в Postgres (Neon).
# =============================================================

FROM node:22-slim

# openssl нужен Prisma для генерации клиента и работы движка запросов
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Лок-файла в репозитории нет — используем npm install.
# Если позже закоммитите package-lock.json, замените на: npm ci
COPY package.json ./
RUN npm install

COPY . .

# Генерирует Prisma Client (то же самое делает postinstall, но явный
# вызов надёжнее, если porядок шагов сборки когда-нибудь поменяется)
RUN npx prisma generate

# Next.js сам подхватывает переменные окружения из process.env на
# этапе билда только для NEXT_PUBLIC_*, которых в проекте нет —
# поэтому секреты в build-время не нужны.
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

RUN chmod +x ./start.sh

CMD ["./start.sh"]
