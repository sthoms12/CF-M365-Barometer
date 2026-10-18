# M365 Barometer

M365 Barometer is a Cloudflare-native public dashboard that automatically monitors recent public discussion about Microsoft 365 products.

For the live production state, remaining work, and exact resume steps, see
[Production Handoff](docs/PRODUCTION_HANDOFF.md).

## Architecture

- One Cloudflare Worker serves the API, scheduled handler, and React static assets.
- Cloudflare D1 stores products, analysis runs, snapshots, and sample mentions.
- Cloudflare Cron Triggers time out stuck analysis runs and enforce snapshot retention.
- An external bot claims due products through the internal API, collects evidence, and ingests it. See [Bot analysis](docs/bot-analysis.md).
- Workers AI classifies evidence and writes summaries. Worker code calculates all public metrics deterministically.

No manual JSON import workflow is included.

## Local Setup

Use Node.js `22.13` or newer. The worker integration tests import `node:sqlite`, which Node includes starting in 22.13.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 create m365-barometer
```

Replace the D1 `database_id` in `wrangler.jsonc`, then:

```powershell
npm run types
npx wrangler d1 migrations apply m365-barometer --local
npm run dev
```

The app builds the React frontend with Vite and serves it through Workers Static Assets at the URL printed by Wrangler.
Local mode serves public, admin, Cron, and D1 behavior. Workers AI is remote-only, so test evidence ingestion against a logged-in remote development session or the deployed Worker.

## Production Setup

Production deploys run from `.github/workflows/deploy.yml` after every push to `main`.
The workflow creates the D1 database when needed, applies migrations, deploys the Worker,
configures Worker secrets, and smoke-tests the public health endpoint.

Analysis is bot-driven. The external bot calls the internal API with `INGEST_TOKEN`. See [Bot analysis](docs/bot-analysis.md).

1. Add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare token with Workers Scripts, D1, and Workers AI permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `INGEST_TOKEN`: A separate long random token shared by the Worker and the analysis bot.

2. Add these GitHub Actions repository variables:

- `PUBLIC_BASE_URL`: The production origin, without a trailing slash. This can be added after the first deployment.
- `CLOUDFLARE_DEPLOY_ENABLED`: Set to `true` only after the secrets above are configured.
- `CUSTOM_DOMAIN`: Optional custom hostname. When set, deployment disables `workers.dev`.

3. Push to `main` or manually run the `Deploy Cloudflare` workflow.
4. After the first deployment, set `PUBLIC_BASE_URL` to the deployed origin and rerun the workflow.

Until `CLOUDFLARE_DEPLOY_ENABLED=true`, pushes still run the full check and build job but skip deployment.

The Cron Trigger runs daily at `06:15 UTC` to time out stuck runs and delete expired snapshots. The external bot claims due products. A successful analysis schedules the next run seven days later, and a failure defers that product by one day.

## Security

- `INGEST_TOKEN` protects run creation, runner context, lifecycle, and evidence ingestion. The analysis bot sends it as a bearer token. See [Bot analysis](docs/bot-analysis.md).
- Public routes never expose raw evidence payloads, tokens, or internal errors.

## Commands

```powershell
npm run dev
npm run test
npm run check
npm run build
npm run deploy
```
