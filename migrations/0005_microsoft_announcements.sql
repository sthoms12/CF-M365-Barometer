-- Latest 30-day Microsoft announcement counts, one row per product.
-- A NULL count means that feed failed on the last collection. A stored 0 is a
-- real empty result from a feed that responded. These rows are not supply or
-- demand signals and do not feed the 0-100 score.
CREATE TABLE product_announcements (
  product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  as_of TEXT NOT NULL,
  message_center_count INTEGER,
  roadmap_count INTEGER,
  roadmap_status_json TEXT,
  collected_at TEXT NOT NULL,
  CHECK (message_center_count IS NULL OR message_center_count >= 0),
  CHECK (roadmap_count IS NULL OR roadmap_count >= 0),
  CHECK (
    (roadmap_count IS NULL AND roadmap_status_json IS NULL)
    OR (roadmap_count IS NOT NULL AND roadmap_status_json IS NOT NULL)
  )
);
