PRAGMA foreign_keys = ON;

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  analysis_query TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  source_config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  next_analysis_at TEXT,
  last_analyzed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE analysis_runs (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  request_key TEXT NOT NULL UNIQUE,
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('scheduled', 'admin_product', 'admin_all')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'dispatched', 'collecting', 'synthesizing', 'completed', 'failed')
  ),
  requested_at TEXT NOT NULL,
  dispatched_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  github_run_url TEXT,
  collector_version TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  raw_evidence_count INTEGER NOT NULL DEFAULT 0,
  source_status_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT
);

CREATE TABLE sentiment_snapshots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  analysis_run_id TEXT NOT NULL UNIQUE REFERENCES analysis_runs(id),
  analyzed_at TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  barometer_score INTEGER NOT NULL CHECK (barometer_score BETWEEN 0 AND 100),
  temperature TEXT NOT NULL CHECK (
    temperature IN ('Hot', 'Warming', 'Stable', 'Cooling', 'Cold')
  ),
  momentum INTEGER NOT NULL,
  confidence TEXT NOT NULL CHECK (
    confidence IN ('Very High', 'High', 'Medium', 'Low')
  ),
  discussion_volume TEXT NOT NULL CHECK (
    discussion_volume IN ('Very High', 'High', 'Medium', 'Low')
  ),
  summary TEXT NOT NULL,
  positive_signals_json TEXT NOT NULL,
  negative_signals_json TEXT NOT NULL,
  source_breakdown_json TEXT NOT NULL,
  source_status_json TEXT NOT NULL,
  classified_evidence_count INTEGER NOT NULL,
  ai_model TEXT NOT NULL
);

CREATE TABLE source_mentions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES sentiment_snapshots(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_url TEXT,
  sentiment TEXT NOT NULL CHECK (
    sentiment IN ('positive', 'neutral', 'negative')
  ),
  excerpt TEXT NOT NULL,
  published_at TEXT,
  source_rank INTEGER NOT NULL
);

CREATE INDEX idx_products_active_due ON products(is_active, next_analysis_at);
CREATE INDEX idx_snapshots_product_date ON sentiment_snapshots(product_id, analyzed_at DESC);
CREATE INDEX idx_mentions_snapshot ON source_mentions(snapshot_id, source_rank);
CREATE INDEX idx_runs_product_date ON analysis_runs(product_id, requested_at DESC);
CREATE INDEX idx_runs_status_date ON analysis_runs(status, requested_at);
