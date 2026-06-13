# M365 Barometer

M365 Barometer is a Cloudflare-native public dashboard that automatically monitors recent public discussion about Microsoft 365 products.

For the live production state, remaining work, and exact resume steps, see
[Production Handoff](docs/PRODUCTION_HANDOFF.md).

## Architecture

- One Cloudflare Worker serves the API, scheduled handler, and React static assets.
- Cloudflare D1 stores products, analysis runs, snapshots, and sample mentions.
- Cloudflare Cron Triggers create due analysis runs and dispatch GitHub Actions.
- GitHub Actions runs the Last30Days Python collector because the full engine requires Python, subprocesses, and `yt-dlp`.
- Workers AI classifies evidence and writes summaries. Worker code calculates all public metrics deterministically.

No manual JSON import workflow is included.

## Local Setup

Use Node.js `20.18.1` or newer.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 create m365-barometer
```

Replace the D1 `database_id` and GitHub values in `wrangler.jsonc`, then:

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

1. Create a fine-grained GitHub token that can dispatch Actions workflows for this repository.
2. Add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`: Cloudflare token with Workers Scripts, D1, and Workers AI permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `INGEST_TOKEN`: A separate long random token shared by the Worker and collector workflow.
- `WORKER_GITHUB_TOKEN`: The fine-grained GitHub token used by the Worker.
- `ADMIN_KEY`: A separate long random key used to sign in to the admin area.

3. Add these GitHub Actions repository variables:

- `PUBLIC_BASE_URL`: The production origin, without a trailing slash. This can be added after the first deployment.
- `CLOUDFLARE_DEPLOY_ENABLED`: Set to `true` only after the secrets above are configured.
- `CUSTOM_DOMAIN`: Optional custom hostname. When set, deployment disables `workers.dev`.
- `INCLUDE_SOURCES`: Optional collector source selection.

4. Optionally add `BRAVE_API_KEY`, `XAI_API_KEY`, and `SCRAPECREATORS_API_KEY` as GitHub Actions secrets.
5. Push to `main` or manually run the `Deploy Cloudflare` workflow.
6. After the first deployment, set `PUBLIC_BASE_URL` to the deployed origin and rerun the workflow.

Until `CLOUDFLARE_DEPLOY_ENABLED=true`, pushes still run the full check and build job but skip deployment.

The Cron Trigger runs daily at `06:15 UTC` and dispatches at most three due products. Each successful product analysis schedules its next run seven days later.

## Admin Area

The admin surface is available at `/admin`. Enter the `ADMIN_KEY` to create a signed,
HTTP-only browser session that lasts 12 hours. The Worker validates that session on every
`/admin/api/*` request. Localhost requests bypass admin authentication for development.

New products begin as drafts. Add recognizable aliases and relevant subreddits, run the
Last30Days test search, then activate products that return at least three usable items.
Products with analysis history can be archived but not deleted.

## Security

- A signed admin-key session protects `/admin/api/*`.
- `INGEST_TOKEN` protects runner context, lifecycle, and evidence ingestion.
- `GITHUB_TOKEN` should be a fine-grained token limited to Actions workflow dispatch for this repository.
- Public routes never expose raw collector payloads, tokens, or internal errors.

## Commands

```powershell
npm run dev
npm run test
npm run check
npm run build
npm run deploy
```
