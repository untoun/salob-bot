# Bothost deployment

The app runs as a standard Node.js/Next.js service on Bothost.

## Bothost settings

- Node.js: `22.x`
- Install: `npm ci`
- Build: `npm run build`
- Start: `npm run start:bothost`
- Port: use the port provided by `PORT` (default `3000`)
- Bind address: `0.0.0.0`

`start:bothost` runs `prisma generate`, applies committed migrations with `prisma migrate deploy`, and starts Next.js. Do not use `prisma migrate dev` in production.

## Required environment variables

```dotenv
MAX_BOT_TOKEN_PROD=
MAX_WEBHOOK_SECRET=
DATABASE_URL=
DIRECT_URL=
CRON_SECRET=
ADMIN_SESSION_SECRET=
SALON_TIMEZONE=Asia/Yekaterinburg
```

Add optional Google Sheets, OpenAI, and salon variables from `.env.example` in the Bothost environment settings. Never commit real secrets.

## Endpoints

- MAX webhook: `POST /api/max/webhook`
- Cron tick: `GET /api/cron/tick`
- Daily cleanup: `GET /api/cron/cleanup`
- Health: `GET /api/health`

Cron requests require:

```http
Authorization: Bearer <CRON_SECRET>
```

Example:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_BOTHOST_DOMAIN/api/cron/tick"
```

Run `/api/cron/tick` every 5 minutes with an external cron service and `/api/cron/cleanup` once per day.

## MAX webhook setup

After Bothost provides the public HTTPS URL, register the webhook:

```bash
npm run max:setup -- https://YOUR_BOTHOST_DOMAIN
```

The `MAX_WEBHOOK_SECRET` used during setup must match the Bothost environment variable.

## First deployment checklist

1. Create or select the production PostgreSQL database.
2. Add all environment variables in Bothost.
3. Ensure `prisma/migrations` is present in the repository.
4. Deploy with the settings above.
5. Check `/api/health`.
6. Register the MAX webhook.
7. Configure external cron requests with the Authorization header.
8. Create the first admin with `npm run admin:create`, then remove `ADMIN_EMAIL` and `ADMIN_PASSWORD` from the environment.
