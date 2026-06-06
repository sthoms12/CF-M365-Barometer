# M365 Barometer

M365 Barometer is a Cloudflare-native public dashboard that automatically monitors recent public discussion about Microsoft 365 products.

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

1. Create the D1 database and update `wrangler.jsonc`.
2. Set Worker secrets:

```powershell
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put GITHUB_TOKEN
```

3. Add the same `INGEST_TOKEN` as a GitHub Actions repository secret.
4. Optionally add `BRAVE_API_KEY`, `XAI_API_KEY`, and `SCRAPECREATORS_API_KEY` as GitHub Actions secrets.
5. Set the GitHub Actions variable `INCLUDE_SOURCES` only when optional sources are configured.
6. Apply migrations and deploy:

```powershell
npx wrangler d1 migrations apply m365-barometer --remote
npm run deploy
```

7. Update `PUBLIC_BASE_URL` in `wrangler.jsonc` to the deployed Worker URL and deploy again.

The Cron Trigger runs daily at `06:15 UTC` and dispatches at most three due products. Each successful product analysis schedules its next run seven days later.

## Cloudflare Access Admin Protection

The complete admin surface uses one protected path:

- Admin UI: `/admin`
- Admin APIs: `/admin/api/*`

Configure a Cloudflare Access self-hosted application:

1. Attach the Worker to a production custom domain managed by Cloudflare.
2. In Zero Trust, create a self-hosted Access application for `<your-domain>/admin*`.
3. Add an Allow policy for the administrator email addresses or identity-provider group.
4. Copy the application's Audience tag into `ACCESS_AUD` in `wrangler.jsonc`.
5. Set `ACCESS_TEAM_DOMAIN` to `<your-team-name>.cloudflareaccess.com`.
6. Deploy the Worker and verify unauthenticated requests to `/admin` redirect to Access.
7. Disable the public `workers.dev` route after the custom domain is working so it cannot bypass the path policy.

The Worker also cryptographically validates the `Cf-Access-Jwt-Assertion` header on every `/admin/api/*` request. Localhost requests bypass Access so local admin development remains usable.

## Security

- Cloudflare Access protects `/admin*`; the Worker validates the Access JWT for admin API requests.
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
