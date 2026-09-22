FROM node:22-bookworm-slim

# ВАЖНО: не /app! Bothost при старте контейнера монтирует /app поверх
# образа исходниками из Git (это нужно для их встроенного редактора кода
# и live-обновлений). Если собрать Next.js-приложение в /app, готовая
# папка .next окажется скрыта этим bind mount'ом сразу после старта —
# именно поэтому раньше падало "Could not find a production build in the
# '.next' directory", хотя сборка внутри Docker-образа проходила успешно.
# Поэтому весь проект живёт в /usr/src/app, вне зоны действия mount'а.
WORKDIR /usr/src/app

# Prisma requires OpenSSL at runtime and during client generation.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy the Prisma schema before dependency installation. package.json has a
# postinstall hook that runs prisma generate, which requires this schema.
COPY package.json ./
COPY prisma ./prisma

# There is currently no package-lock.json, so npm ci cannot be used yet.
# Skip lifecycle scripts until the full source tree is available.
RUN npm install --no-audit --no-fund --ignore-scripts

COPY . .

# Next.js type-checking/build workers exceed Node's default ~512 MB heap on
# Bothost. Keep the limit below a 1 GB container's total memory.
ENV NODE_OPTIONS=--max-old-space-size=768
ENV NEXT_TELEMETRY_DISABLED=1

RUN npx prisma generate
RUN npm run build
# Fail the image build here instead of allowing a broken container to start.
RUN test -f .next/BUILD_ID

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "start:bothost"]
