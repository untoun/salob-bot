# Виртуальный администратор салона — бот MAX + онлайн-запись + админ-панель

Бот в мессенджере **MAX**, который ведёт клиента от первого сообщения до подтверждённой записи, присылает
напоминания, работает с Google Таблицей и имеет админ-панель. Развёртывание — **Vercel** (serverless),
данные — **PostgreSQL** (Neon), помощник — **OpenAI**.

> **Статус проверки.** Код написан и разобран статически, часть логики (слоты, защита ответов AI, телефоны,
> кнопки, статусы, права, расписание, календарь) проверена автономными тестами. Полная сборка, интеграционные
> тесты и работа с живыми MAX / Google / OpenAI **должны быть выполнены вами** — порядок в
> [docs/TEST-SCENARIO.md](docs/TEST-SCENARIO.md), статус каждого пункта — в [docs/CHECKLIST.md](docs/CHECKLIST.md).

## Возможности

- Меню на нативных кнопках MAX: услуги, прайс, мастера, акции, контакты, вопросы, «Моя запись», команды `/start /menu /booking /services /masters /promotions /mybooking /contacts /help`.
- Запись за 2–3 нажатия: услуга → допуслуга → мастер → дата → время → имя/телефон → подтверждение. Перенос и отмена.
- **Защита от двойной записи** (блокировка мастера в БД + повторный расчёт слота + уникальный индекс).
- Напоминания за 24 и за 2 часа, уведомления об отмене, уведомления администратору с кнопками, вопрос администратору с ответом из чата.
- AI-консультант (OpenAI): подбирает услугу, но не придумывает цены, слоты и услуги — факты проверяет код.
- Google Таблица: 8 листов, двусторонняя синхронизация статусов, комментариев, услуг и мастеров; PostgreSQL остаётся источником истины.
- Админ-панель `/admin`: обзор дня, календарь (день/неделя/месяц), записи, клиенты (с удалением данных по запросу), услуги, мастера, расписание, акции, FAQ, сотрудники, журнал, Google Таблица. Роли `SUPER_ADMIN`, `ADMIN`, `MASTER`.

**Пока не сделано:** раздел «Портфолио» в боте и панели (нужны загрузка изображений во внешнее хранилище и формат вложения MAX), MAX Mini App (архитектура готова, см. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), кнопка «Позвонить» (тип кнопки в документации MAX не найден — телефон показывается текстом).

## Архитектура

```
MAX ──HTTPS webhook──▶ /api/max/webhook ──▶ lib/bot (FSM в БД) ──▶ lib/booking ──▶ PostgreSQL (Neon)
                                   │                                  ▲
                                   └─▶ lib/openai (консультант)       │
Планировщик (5 мин) ─▶ /api/cron/tick ─┬─▶ lib/notifications ─▶ MAX API   │
                                        └─▶ lib/google ─▶ Google Sheets ───┘ (очередь SyncQueue)
Vercel Cron (раз в сутки) ─▶ /api/cron/cleanup
Браузер ─▶ /admin (Next.js, middleware + серверные проверки) ─▶ lib/admin, lib/booking
```

Ни одного постоянного процесса: нет `listen()`, `setInterval`, in-memory состояния. Состояние диалога, очереди, лимиты
частоты и идемпотентность хранятся в PostgreSQL. Подробнее — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Требования

Node.js 22 LTS (в `package.json` закреплено `22.x`; минимум для скриптов с `--env-file` — 20.6), аккаунты: MAX (бот), Neon, Google Cloud, OpenAI (по желанию), Vercel, GitHub.
Vercel Hobby допускает cron только раз в сутки (и предназначен для некоммерческого использования). Для напоминаний и синхронизации нужен вызов **каждые 5 минут**: на Hobby — через внешний бесплатный планировщик (см. [docs/CRON.md](docs/CRON.md)), на Pro — cron прямо в `vercel.json`.

## Быстрый старт (локально)

```bash
npm install
cp .env.example .env                # заполните значения (см. ниже); файл читают и Next.js, и Prisma CLI, в Git он не попадает
npx prisma migrate dev --name init   # создаст таблицы И папку prisma/migrations — её нужно закоммитить
npm run db:seed                      # тестовые услуги, мастера, график, FAQ
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='не-короче-12-символов' npm run admin:create
npm run dev                          # http://localhost:3000/admin
```

База для разработки: отдельная ветка Neon **или** `docker compose up -d` (PostgreSQL в контейнере, строки подключения в комментарии `docker-compose.yml`).
Никогда не используйте боевую базу и боевой токен бота в разработке.

Чтобы протестировать бота с локальной машины, нужен HTTPS-туннель (Cloudflare Tunnel, ngrok) и **тестовый** бот MAX:
`npm run max:setup -- https://ваш-туннель.example`.

## 1. Бот в MAX и токен

1. В MAX найдите **Master Bot** (бот для создания ботов), создайте бота, задайте имя и описание. Получите **токен**.
2. Токен храните только в переменных окружения: `MAX_BOT_TOKEN_PROD` (боевой), `MAX_BOT_TOKEN_DEV` (тестовый). На Vercel `production` использует PROD-токен, `preview` и `development` — DEV.
3. Придумайте `MAX_WEBHOOK_SECRET` — 5–256 символов `[a-zA-Z0-9_-]` (`openssl rand -hex 32` подходит).
4. **Сертификат.** API MAX (`https://platform-api2.max.ru`) использует сертификат российского удостоверяющего центра Минцифры, которого нет в списке доверенных на серверах Vercel. Скачайте корневой (и при необходимости промежуточный) сертификат из раздела о сертификатах Минцифры (ссылку смотрите в документации MAX) в формате PEM и передайте в `MAX_EXTRA_CA_PEM` — как PEM с переносами строк либо в base64 одной строкой (`base64 -w0 certs.pem`). Проверка TLS не отключается.
5. Убедитесь, что серверы Vercel достают до API MAX: после деплоя `GET /api/health?deep=1` (см. ниже) покажет `"max": "ok"`.
6. Регистрация webhook и команд: `npm run max:setup -- https://ВАШ-ДОМЕН.vercel.app` (подписка на `message_created`, `message_callback`, `bot_started`, `bot_stopped`, `dialog_removed`). Webhook принимается только с заголовком `X-Max-Bot-Api-Secret`.
7. Узнать свой MAX ID (для уведомлений администратору): напишите боту `/id` и добавьте число в `ADMIN_MAX_USER_IDS`.

## 2. Neon (PostgreSQL)

1. neon.com → Create project (регион ближе к Vercel-региону функций).
2. Скопируйте **две** строки подключения: pooled (хост с `-pooler`) → `DATABASE_URL` (добавьте `?pgbouncer=true&connect_timeout=15`), прямую → `DIRECT_URL` (для миграций).
3. Для разработки и тестов создайте отдельные ветки Neon — не смешивайте с боевыми данными.

## 3. Google Таблица

1. console.cloud.google.com → новый проект → **Google Sheets API** → Enable.
2. IAM → Service accounts → Create → Keys → **Add key → JSON**. Из файла нужны `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` и `private_key` → `GOOGLE_PRIVATE_KEY` (в переменной переносы строк как `\n`).
3. Создайте пустую Google Таблицу с любым названием и **поделитесь ею с e-mail сервисного аккаунта** (роль «Редактор»). Id таблицы из URL (`/d/<ID>/edit`) → `GOOGLE_SHEET_ID`.
4. Листы, заголовки и выпадающий список статусов создаются автоматически при первой синхронизации. Правила редактирования — в панели `/admin/sheets`.
5. JSON-ключ не коммитьте (в `.gitignore` уже есть `google-service-account*.json`).

## 4. OpenAI (по желанию)

Создайте API-ключ → `OPENAI_API_KEY`; модель `OPENAI_MODEL` (по умолчанию `gpt-4o-mini`), потолок ответов в сутки `AI_DAILY_LIMIT`.
Без ключа бот работает без помощника. В OpenAI уходит только каталог салона и текст сообщения клиента (телефоны и e-mail вырезаются).

## Переменные окружения

| Переменная | Обязательно | Назначение |
|---|---|---|
| `MAX_BOT_TOKEN_PROD` / `MAX_BOT_TOKEN_DEV` | да | токены бота (боевой / тестовый) |
| `MAX_WEBHOOK_SECRET` | да | секрет вебхука (`X-Max-Bot-Api-Secret`) |
| `MAX_API_URL` | нет | по умолчанию `https://platform-api2.max.ru` |
| `MAX_EXTRA_CA_PEM` | да на Vercel | корневые сертификаты Минцифры (PEM или base64) |
| `DATABASE_URL`, `DIRECT_URL` | да | Neon pooled / direct |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` | нет* | синхронизация с таблицей (*без них выключена) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_DAILY_LIMIT` | нет | AI-консультант |
| `CRON_SECRET` | да | ≥16 символов; Vercel Cron шлёт его как `Bearer` |
| `ADMIN_SESSION_SECRET` | да | ≥32 символов, подпись сессий панели |
| `ADMIN_MAX_USER_IDS` | рекомендуется | MAX ID администраторов через запятую |
| `SALON_TIMEZONE` | да | по умолчанию `Asia/Yekaterinburg` |
| `SALON_NAME`, `SALON_PHONE`, `SALON_ADDRESS`, `SALON_HOURS`, `SALON_WEBSITE`, `SALON_SOCIAL_URL` | да/нет | данные салона в боте |
| `SALON_LEGAL_NAME`, `PRIVACY_POLICY_URL` | рекомендуется | оператор ПДн и ссылка на политику |

Никаких секретов в `NEXT_PUBLIC_*`, в репозитории, в `public/` и в клиентском коде. `ADMIN_EMAIL` / `ADMIN_PASSWORD` нужны только команде `npm run admin:create`.

## Деплой на Vercel

1. Создайте репозиторий на GitHub, загрузите проект (включая `prisma/migrations` и `package-lock.json` — он появится после `npm install`; без него CI-команда `npm ci` не сработает).
2. Vercel → Add New Project → импортируйте репозиторий → Framework **Next.js**.
3. Добавьте Environment Variables **раздельно** для Production / Preview / Development (боевые значения только в Production; в Preview — тестовый бот, тестовая таблица и ветка БД).
4. База: используйте строки Neon из раздела 2.
5. Миграции — отдельным шагом, не при запросах: `DIRECT_URL=<прямая строка> npx prisma migrate deploy` (с вашей машины или из CI). `prisma migrate dev` в production не используется.
6. Deploy. Получите production URL.
7. Webhook на production URL: `npm run max:setup -- https://ВАШ-ДОМЕН.vercel.app` (с боевым токеном и `VERCEL_ENV=production`). Preview-деплои **не** переключают webhook: для теста используйте отдельного тестового бота.
8. Создайте первого владельца: `npm run admin:create` (с `DATABASE_URL`/`DIRECT_URL` боевой базы) и уберите `ADMIN_PASSWORD` из окружения.
9. Cron: `vercel.json` содержит только ежедневную очистку (`/api/cron/cleanup`) — этого достаточно для тарифа Hobby. Напоминания и синхронизация выполняются адресом `/api/cron/tick` **каждые 5 минут**: настройте внешний планировщик по [docs/CRON.md](docs/CRON.md) (Hobby) либо добавьте расписание в `vercel.json` (Pro). Без этого напоминания не отправляются, а записи не попадают в таблицу.

### Проверка после деплоя

```bash
# состояние (публично: только БД)
curl https://ВАШ-ДОМЕН.vercel.app/api/health
# подробно (MAX, Google, OpenAI): нужен CRON_SECRET
curl -H "Authorization: Bearer $CRON_SECRET" "https://ВАШ-ДОМЕН.vercel.app/api/health?deep=1"
# cron вручную
curl -H "Authorization: Bearer $CRON_SECRET" https://ВАШ-ДОМЕН.vercel.app/api/cron/tick   # напоминания + синхронизация
```

Без секрета cron возвращает `401`. Дальше — полный тестовый сценарий из [docs/TEST-SCENARIO.md](docs/TEST-SCENARIO.md).

## Тесты и качество

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

- Обычные тесты не требуют БД и сети.
- Интеграционные (двойная запись, отмена, перенос, запись от администратора, удаление данных): `TEST_DATABASE_URL=postgresql://... npm test` — **только тестовая база**, тесты создают и удаляют свои данные.
- CI (`.github/workflows/ci.yml`) прогоняет всё на PostgreSQL в контейнере при каждом push.

## Безопасность и персональные данные

Кратко: webhook и cron защищены секретами; вход в панель ограничен по IP и email, пароли — bcrypt, сессии в `HttpOnly`/`Secure`/`SameSite=Strict` cookie, роль берётся из БД при каждом запросе, CSRF-токен в каждой форме; ввод валидируется на сервере; логи без секретов и с маскированием телефонов. Подробно — [docs/SECURITY.md](docs/SECURITY.md).

**152-ФЗ.** Сервис хранит имена и телефоны за пределами РФ (Vercel, Neon, Google, OpenAI). Если вы обязаны хранить ПДн россиян в России, замените PostgreSQL на российского провайдера (достаточно сменить `DATABASE_URL`), отключите или маскируйте Google Таблицу и AI. Страницы `/privacy` и `/terms` — **шаблоны**, их должен проверить юрист.

## Резервные копии

Google Таблица **не** является бэкапом. Используйте восстановление на момент времени в Neon и/или `scripts/backup.sh` (pg_dump) по расписанию в зашифрованное хранилище. См. [docs/BACKUP.md](docs/BACKUP.md).

## Если что-то не работает

| Симптом | Причина / действие |
|---|---|
| Бот молчит, в логах `certificate` / `UNABLE_TO_VERIFY` | не задан или неверен `MAX_EXTRA_CA_PEM` |
| Вебхук `401` | `MAX_WEBHOOK_SECRET` в Vercel и в подписке (`max:setup`) различаются |
| `Invalid environment variables: …` | не заполнена обязательная переменная (имя указано в сообщении, значение не выводится) |
| Не видно записей в таблице | `/admin/sheets`: таблица не расшарена сервисному аккаунту либо не включён Sheets API |
| Напоминания приходят с задержкой | частота cron в `vercel.json`; тариф Vercel |
| Ошибки Prisma про `prepared statement` | в `DATABASE_URL` нет `?pgbouncer=true` |
| Вход в панель «Слишком много попыток» | подождите 15 минут или сбросьте пароль в разделе «Сотрудники» |
