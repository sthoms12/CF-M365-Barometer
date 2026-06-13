ALTER TABLE products ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('draft', 'ready', 'active', 'archived'));

CREATE TABLE product_validations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'collecting', 'ready', 'needs_attention', 'failed')),
  requested_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  source_status_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT
);

CREATE INDEX idx_product_validations_product_date
  ON product_validations(product_id, requested_at DESC);
