# Production Handoff

Last updated: June 7, 2026

This is the restart point for M365 Barometer production work.

## Current State

- Production app: <https://m365-barometer.sthoms105.workers.dev>
- GitHub repository: <https://github.com/sthoms12/CF-M365-Barometer>
- Default branch: `main`
- Deployment workflow: `Deploy Cloudflare`
- Collector workflow: `Last30Days Product Analysis`
- Production D1 database: `m365-barometer`
- Cron schedule: daily at `06:15 UTC`
- Deployment on pushes to `main`: enabled
- GitHub and Cloudflare secrets: configured
- Latest deployment: passed
- Latest end-to-end product analysis: passed
- Products seeded: 11
- Products with a completed reading: 1

The production smoke analysis completed for Microsoft 365 Copilot with six classified
evidence items. The result is visible on the live dashboard.

## Remaining Work

### Priority 1: Protect the Admin Surface

The public dashboard is production-ready, but the admin surface is not ready for normal use.
The Worker rejects production admin API requests because Cloudflare Access is not configured.

1. Choose or purchase a custom domain managed by Cloudflare.
2. Set GitHub repository variable `CUSTOM_DOMAIN` to the production hostname.
3. Create a Cloudflare Zero Trust self-hosted Access application for `<hostname>/admin*`.
4. Add an Allow policy for the intended administrator identities.
5. Set repository variables:
   - `ACCESS_TEAM_DOMAIN`
   - `ACCESS_AUD`
6. Run `Deploy Cloudflare`.
7. Verify `/admin` redirects unauthenticated users to Access.
8. Verify authenticated admin operations work.

Setting `CUSTOM_DOMAIN` causes the generated production config to disable the public
`workers.dev` route, preventing it from bypassing Access.

### Priority 2: Tighten Credentials

- Replace `CLOUDFLARE_API_TOKEN` with a dedicated long-lived API token scoped only to the
  required Workers, D1, Workers AI, and route permissions.
- Replace `WORKER_GITHUB_TOKEN` with a fine-grained token limited to this repository and
  Actions workflow dispatch.
- Record token owners and rotation dates outside the repository.

Never store credential values in this document or any committed file.

### Priority 3: Improve Collection Quality

The collector currently works without paid source APIs, but the first reading had low
confidence because it found only six usable evidence items.

Optional GitHub Actions secrets:

- `BRAVE_API_KEY`
- `XAI_API_KEY`
- `SCRAPECREATORS_API_KEY`

Optional repository variable:

- `INCLUDE_SOURCES`

After adding sources, trigger a product analysis and confirm evidence count, source diversity,
and confidence improve before enabling more frequent analysis.

### Priority 4: Operations and Quality

- Confirm the daily Cron Trigger dispatches due products successfully over a full week.
- Add Cloudflare usage/billing notifications for Workers AI, Workers, and D1.
- Add GitHub Actions budget notifications.
- Add alerting for failed or timed-out analysis runs.
- Establish a periodic D1 export/backup procedure.
- Add integration tests for D1 ingestion, scheduling, GitHub dispatch, and admin authorization.
- Add visible frontend error states to product and product-list pages.
- Consider branch protection if the repository plan supports it.

## Resume Checklist

Run these first whenever resuming work:

```powershell
git fetch origin main
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
npm install
npm run check
```

Expected synchronization result:

```text
0  0
```

Verify production:

```powershell
Invoke-RestMethod https://m365-barometer.sthoms105.workers.dev/api/health
gh run list --repo sthoms12/CF-M365-Barometer --limit 5
npx wrangler deployments list
```

Expected health response:

```json
{"ok":true}
```

## Deployment Runbook

Every push to `main` runs checks and deploys through `.github/workflows/deploy.yml`.

Manual deployment:

```powershell
gh workflow run deploy.yml --repo sthoms12/CF-M365-Barometer
gh run list --repo sthoms12/CF-M365-Barometer --workflow deploy.yml --limit 1
gh run watch <run-id> --repo sthoms12/CF-M365-Barometer
```

The workflow:

1. Installs dependencies.
2. Runs types, tests, and the production build.
3. Finds or creates production D1.
4. Applies migrations.
5. Deploys the Worker and static assets.
6. Configures Worker secrets.
7. Smoke-tests `/api/health`.

## Analysis Runbook

Normal analyses are created by the Worker through the admin API or daily Cron Trigger. The
Worker dispatches `.github/workflows/last30days.yml`, which collects evidence and ingests it
back into the Worker.

Review recent runs:

```powershell
gh run list --repo sthoms12/CF-M365-Barometer --workflow last30days.yml --limit 10
```

Inspect a failed run:

```powershell
gh run view <run-id> --repo sthoms12/CF-M365-Barometer --log-failed
npx wrangler tail m365-barometer
```

Production run status is also available in D1 table `analysis_runs`.

## Production Configuration

Configured GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `INGEST_TOKEN`
- `WORKER_GITHUB_TOKEN`

Configured repository variables:

- `CLOUDFLARE_DEPLOY_ENABLED=true`
- `PUBLIC_BASE_URL=https://m365-barometer.sthoms105.workers.dev`

Not configured yet:

- `CUSTOM_DOMAIN`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`
- `INCLUDE_SOURCES`
- Optional collector API keys

`wrangler.jsonc` intentionally contains local-development placeholders. The deployment workflow
creates ignored `wrangler.production.jsonc` from GitHub variables and discovered D1 resources.

## Cost Expectations

The current workload should remain within the Cloudflare and GitHub free allowances.
Workers AI is the component most likely to hit a free limit first. On Cloudflare Workers Free,
exceeding the Workers AI daily allowance should cause requests to fail rather than create
usage charges. Review provider billing settings before changing plans or increasing frequency.

## Known History

- Initial deployment attempts failed because the deploy job did not build static assets or
  generate Worker types. Both issues are fixed.
- Initial end-to-end analysis attempts failed because Workers AI returned structured JSON while
  the Worker expected a JSON string. This is fixed and covered by regression tests.
- The older failed GitHub workflow runs remain visible as deployment history and require no action.
