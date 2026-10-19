# Bot analysis

The Worker cron `15 6 * * *` does not collect evidence. It only marks runs older than 30 minutes as failed and deletes expired snapshots. An external bot claims each product, collects evidence, and calls the internal API.

Every `/api/internal/*` route requires:

```http
Authorization: Bearer $INGEST_TOKEN
```

Missing or wrong tokens receive `401` `{ "error": "Unauthorized" }`.

## Flow

1. `GET /api/internal/analysis-runs/due`
2. `POST /api/internal/analysis-runs`
3. `POST /api/internal/analysis-runs/:id/start`
4. `POST /api/internal/analysis-runs/:id/ingest` or `POST /api/internal/analysis-runs/:id/fail`

`GET /api/internal/analysis-runs/:id/context` returns the same `context` object that create returns.

## List due products

```http
GET /api/internal/analysis-runs/due
```

```json
{ "slugs": ["microsoft-365-copilot", "teams-phone"] }
```

A product is due when `is_active = 1`, `lifecycle_status = 'active'`, and `next_analysis_at` is null or at or before the current time. Null schedules are treated as oldest. Slugs are ordered oldest first.

## Create a run

```http
POST /api/internal/analysis-runs
Content-Type: application/json
```

Body is optional. Omit it, or send `{}`, to claim the oldest due product. Send a slug to create a run for that active product even when it is not due:

```json
{ "productSlug": "microsoft-365-copilot" }
```

`200` response:

```json
{
  "runId": "0f5d0c2e-7b4a-4e2e-9c1a-6b8d9e0f1a2b",
  "context": {
    "runId": "0f5d0c2e-7b4a-4e2e-9c1a-6b8d9e0f1a2b",
    "product": {
      "id": "prod-m365-copilot",
      "name": "Microsoft 365 Copilot",
      "analysisQuery": "\"Microsoft 365 Copilot\" OR \"M365 Copilot\"",
      "aliases": ["M365 Copilot", "Copilot for Microsoft 365"]
    },
    "queryPlan": {
      "intent": "Measure recent public sentiment around Microsoft 365 Copilot",
      "freshness_mode": "strict",
      "cluster_mode": "topic",
      "raw_topic": "\"Microsoft 365 Copilot\" OR \"M365 Copilot\"",
      "subqueries": [],
      "source_weights": {},
      "notes": []
    },
    "subreddits": ["Microsoft365", "microsoft", "sysadmin"]
  }
}
```

`context` is exactly the `GET /api/internal/analysis-runs/:id/context` body. `subqueries`, `source_weights`, and `notes` are filled from the product's analysis query and subreddit config; the arrays above are only showing the keys.

The new row uses `trigger_type` `scheduled` (the `analysis_runs` check constraint does not allow `bot`) and `status` `pending`.

- `204` with an empty body when no slug was sent and nothing is due.
- `404` `{ "error": "Product not found" }` when `productSlug` is not an active product.
- `400` when the body is not a JSON object or `productSlug` is not a string.

Creating a run does not move `next_analysis_at`. Call create once, then finish with ingest or fail.

## Start

```http
POST /api/internal/analysis-runs/:id/start
Content-Type: application/json

{}
```

```json
{ "ok": true }
```

The run status becomes `collecting`.

## Ingest

```http
POST /api/internal/analysis-runs/:id/ingest
Content-Type: application/json
```

```json
{
  "collectorVersion": "bot-1",
  "windowStart": "2026-09-18T00:00:00.000Z",
  "windowEnd": "2026-10-18T00:00:00.000Z",
  "sourceStatus": {
    "reddit": "available",
    "youtube": "returned_zero",
    "hackernews": "failed"
  },
  "evidence": [
    {
      "id": "reddit:1",
      "source": "reddit",
      "title": "Copilot saved me time",
      "url": "https://example.com/post",
      "excerpt": "It drafted the summary correctly.",
      "publishedAt": "2026-10-01T12:00:00.000Z",
      "rank": 1
    }
  ]
}
```

`sourceStatus` values are `available`, `unavailable`, `failed`, or `returned_zero`. `evidence` has 1 to 60 items. `url` and `publishedAt` are optional.

Success `200`:

```json
{ "snapshotId": "b7c1c2a0-1d2e-4f30-8a11-9c0b7a6e5d44", "score": 67 }
```

The run becomes `completed`. The product's `next_analysis_at` is set to seven days later.

If Workers AI scoring fails, the response is `500` instead of a generic error body:

```json
{ "errorCode": "AI_SCORING_FAILED", "message": "Workers AI returned no response" }
```

That run is marked `failed`, and the product's `next_analysis_at` is set to one day later.

## Fail

```http
POST /api/internal/analysis-runs/:id/fail
Content-Type: application/json
```

```json
{ "errorCode": "COLLECTOR_FAILED", "errorMessage": "Collector returned fewer than three usable items" }
```

Both fields are optional. They default to `COLLECTOR_FAILED` and `Collector failed`.

```json
{ "ok": true }
```

The run is marked `failed`. `next_analysis_at` is set to one day later so the same product is not immediately claimed again.

## Push weekly signals

The Worker cron collects message center, roadmap, Wikipedia pageviews, and Hacker News for the last completed ISO week. It does not call X, YouTube, or Tech Community. Push those counts here. Reddit is not accepted.

```http
POST /api/internal/signals
Content-Type: application/json
```

```json
{
  "signals": [
    {
      "productSlug": "microsoft-365-copilot",
      "week": "2026-10-12",
      "source": "x",
      "kind": "demand",
      "value": 832
    },
    {
      "productSlug": "microsoft-365-copilot",
      "week": "2026-10-12",
      "source": "youtube",
      "kind": "supply",
      "value": 14
    },
    {
      "productSlug": "microsoft-365-copilot",
      "week": "2026-10-12",
      "source": "tech_community",
      "kind": "demand",
      "value": 6,
      "estimated": false
    }
  ]
}
```

`source` is `x`, `youtube`, or `tech_community`. `x` must be `demand`. `youtube` must be `supply`. `tech_community` may be either: use `supply` for blog posts and `demand` for question volume. One row is stored per product, week, and source, so a second post for the same key replaces the first.

`week` is an ISO date. A date that is not a Monday is stored on that week's Monday. `value` is a count, not a score. Set `estimated` when the count is incomplete. `meta` is an optional object stored with the row.

```json
{ "stored": 3 }
```

- `400` when the body, source, or kind is not valid.
- `404` `{ "error": "Product not found: <slug>" }` when a slug is missing.
- `401` when the bearer token is missing or wrong.

## Backfill Wikipedia and Hacker News

```http
POST /api/internal/signals/backfill
Content-Type: application/json
```

```json
{ "weeks": 26, "sources": ["wikipedia", "hacker_news"] }
```

`weeks` defaults to 26 and cannot exceed 26. `sources` defaults to both Wikipedia and Hacker News. Message center and roadmap are not backfilled here; the daily cron records the latest completed week from those feeds. Optional `productSlug` limits the run to one product, including an inactive one.

The response lists `wrote`, `skipped` (products with no Wikipedia article), and `errors`. A missing `productSlug` returns `404`.

## Timeout

A run still `pending`, `dispatched`, `collecting`, or `synthesizing` 30 minutes after `requested_at` is marked `failed` with `error_code` `RUN_TIMEOUT`. Its product is also deferred by one day. The cron performs that update and the snapshot retention cleanup.
