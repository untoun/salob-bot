# Деплой на Bothost.ru

Этот файл — дополнение к основному `README.md` и `docs/CRON.md`. Там уже подробно
расписано, что делает бот, где взять токены Neon/Google/OpenAI и как работает
защита `/api/cron/*`. Здесь — только то, что отличается от Vercel.

Проект уже спроектирован без единого постоянного процесса и без in-memory
состояния (см. `docs/ARCHITECTURE.md`) — это ровно то, что нужно, чтобы он
одинаково хорошо работал и как serverless-функции на Vercel, и как один
Docker-контейнер на Bothost.

## Что изменилось для Bothost

1. Добавлен `Dockerfile` — Bothost запускает ботов в Docker-контейнерах и
   монтирует `/app` поверх образа исходниками из Git. Next.js кладёт сборку в
   `.next`, поэтому весь проект собирается в `/usr/src/app` (вне `/app`) —
   иначе контейнер падал бы с `Cannot find module '.next/...'`
   (см. bothost.ru/docs/common-errors).
2. Добавлен `start.sh` — перед запуском `next start` он выполняет
   `npx prisma migrate deploy`, то есть применяет накопленные миграции при
   каждом старте контейнера. Это безопасно: если новых миграций нет, команда
   ничего не делает.
3. Не используется `VERCEL_ENV` (на Bothost такой переменной просто нет) —
   значит, вместо `MAX_BOT_TOKEN_PROD` / `MAX_BOT_TOKEN_DEV` достаточно задать
   один `MAX_BOT_TOKEN` (в коде `lib/config/env.ts` он используется как
   запасной вариант — трогать код не нужно).
4. `vercel.json` и `docker-compose.yml` на Bothost не используются, их можно
   оставить в репозитории — они не мешают сборке.

## 1. Перед первым деплоем — миграции Prisma

В репозитории пока нет папки `prisma/migrations` (её создаёт
`prisma migrate dev`). Сделайте это один раз **локально**, до пуша на Bothost:

```bash
npm install
cp .env.example .env
# впишите в .env боевые (или тестовые) DATABASE_URL / DIRECT_URL от Neon
npx prisma migrate dev --name init
```

Закоммитьте появившуюся папку `prisma/migrations/` в Git — без неё
`prisma migrate deploy` в `start.sh` применять будет нечего.

## 2. Заливаем в Git

```bash
git init
git add .
git commit -m "Deploy on Bothost"
git remote add origin https://github.com/username/salon-bot.git
git push -u origin main
```

## 3. Создаём бота на Bothost

1. Личный кабинет Bothost → «Создать бота».
2. Платформа: **Max**. Git URL — ваш репозиторий, ветка `main`.
3. В «Дополнительных настройках» включите **«Использовать собственный
   Dockerfile»** — обязательно, иначе Bothost сгенерирует свой Dockerfile,
   который не учтёт особенности Next.js + Prisma.
4. Внутренний порт — `3000` (совпадает с тем, что слушает `start.sh`).
5. Включите **«Использовать домен»** — он нужен и для вебхука MAX, и для
   внешнего cron.

## 4. Переменные окружения

Возьмите список из `.env.example` / README, с двумя отличиями:

| Переменная | На Bothost |
|---|---|
| `MAX_BOT_TOKEN` | вместо `MAX_BOT_TOKEN_PROD`/`MAX_BOT_TOKEN_DEV` — один токен |
| `MAX_WEBHOOK_SECRET` | как в README — `openssl rand -hex 32` |
| `MAX_EXTRA_CA_PEM` | обязательно (см. README, раздел 1, пункт 4) — сертификат Минцифры нужен независимо от хостинга, это про доверенные CA в Node.js, а не про Vercel |
| `DATABASE_URL`, `DIRECT_URL` | как раньше — из Neon (Bothost не предоставляет управляемый Postgres, отдельная СУБД не нужна, продолжайте использовать Neon) |
| `GOOGLE_*`, `OPENAI_*` | без изменений |
| `CRON_SECRET`, `ADMIN_SESSION_SECRET` | без изменений |
| `PRIVACY_POLICY_URL` | задайте явно (на Bothost нет `VERCEL_PROJECT_PRODUCTION_URL`, от которого раньше строился адрес по умолчанию) — например `https://ваш-бот.bothost.tech/privacy` |
| `SALON_*` | без изменений |

Добавьте всё это в разделе «Переменные окружения» при создании бота.

## 5. Про OpenAI и Google Sheets — «зарубежный IP»

Проект стучится в OpenAI и Google API — это внешние (не российские) сервисы.
Если после деплоя `GET /api/health?deep=1` покажет `openai`/`google` как
`error`, включите в [профиле Bothost](https://bothost.ru/profile.php) опцию
**«Зарубежный IP для API и нейросетей»** и передеплойте бота (существующие
боты сами не переезжают на новую ноду).

MAX API (`platform-api2.max.ru`) — российский сервис, его это не касается.

## 6. Деплой и первый запуск

1. Нажмите «Создать бота», дождитесь сборки — смотрите **логи сборки** (шаги
   Docker) и **логи работы** (там же появится `==> Применяю миграции...` и
   затем `✓ Ready` от Next.js).
2. Проверьте `https://ваш-бот.bothost.tech/api/health` — должно быть
   `{"status":"ok","database":"ok"}`.

## 7. Регистрируем вебхук и команды в MAX

Bothost даёт встроенный терминал в контейнере бота (тот же, что используется
для SQLite в документации Bothost). Откройте его на карточке бота и выполните:

```bash
npm run max:setup -- https://ваш-бот.bothost.tech
```

Это подпишет бота на `message_created`, `message_callback`, `bot_started`,
`bot_stopped`, `dialog_removed` и загрузит список команд — см. вывод в README,
раздел 1.

## 8. Создаём первого администратора

Там же, в терминале:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='не-короче-12-символов' npm run admin:create
```

После этого можно зайти в `/admin` на домене бота.

## 9. Настраиваем внешний cron

У Bothost нет встроенного планировщика — как раз то, для чего
`docs/CRON.md` уже описывает «Вариант A» (внешний планировщик). Только вместо
`https://ВАШ-ДОМЕН.vercel.app` используйте домен Bothost:

На **cron-job.org** создайте две задачи:

**Напоминания и синхронизация — каждые 5 минут:**
- URL: `https://ваш-бот.bothost.tech/api/cron/tick`
- Метод: **GET**
- Заголовок: `Authorization: Bearer ВАШ_CRON_SECRET`
- Расписание: каждые 5 минут

**Очистка — раз в сутки:**
- URL: `https://ваш-бот.bothost.tech/api/cron/cleanup`
- Метод: **GET**
- Заголовок: `Authorization: Bearer ВАШ_CRON_SECRET`
- Расписание: раз в сутки (например, 03:00)

Проверка вручную:
```bash
curl -H "Authorization: Bearer ВАШ_CRON_SECRET" https://ваш-бот.bothost.tech/api/cron/tick
curl -H "Authorization: Bearer ВАШ_CRON_SECRET" https://ваш-бот.bothost.tech/api/cron/cleanup
```
Оба должны вернуть `{"ok":true,...}`.

## 10. Чек-лист после деплоя

- [ ] `prisma/migrations` закоммичены и применились (видно в логах работы контейнера)
- [ ] `GET /api/health` → `ok`
- [ ] `GET /api/health?deep=1` с `Authorization: Bearer $CRON_SECRET` → `max: ok`
      (если нет — проверьте `MAX_EXTRA_CA_PEM` и токен)
- [ ] `npm run max:setup -- https://...` выполнен, вебхук подписан
- [ ] Тестовое сообщение боту в MAX доходит и отвечает
- [ ] cron-job.org дергает `/api/cron/tick` каждые 5 минут и получает `ok:true`
- [ ] `/admin` открывается, вход работает
- [ ] Если используете OpenAI/Google — включён «Зарубежный IP» в профиле Bothost

Дальше используйте `docs/TEST-SCENARIO.md` и `docs/CHECKLIST.md` из репозитория
для полной проверки бизнес-логики — они не зависят от хостинга.
