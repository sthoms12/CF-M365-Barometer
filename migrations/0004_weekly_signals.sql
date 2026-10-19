-- Weekly supply and demand observations. One row per product, ISO week, and source.
-- Live databases do not have this table yet, so this migration is new work.
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('supply', 'demand')),
  value REAL NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  collected_at TEXT NOT NULL,
  UNIQUE (product_id, week, source)
);

CREATE INDEX idx_signals_product_week ON signals(product_id, week);

-- Wikipedia titles and Hacker News queries for the seeded catalog.
-- Articles that cover a broader product than the row are marked estimated.
UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Outlook_for_Windows',
  '$.wikipediaEstimated', json('false'),
  '$.hnQuery', '"new Outlook" OR "Outlook for Windows"'
)
WHERE slug = 'new-outlook' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Microsoft_Copilot',
  '$.wikipediaEstimated', json('true'),
  '$.hnQuery', '"Microsoft 365 Copilot"'
)
WHERE slug = 'microsoft-365-copilot' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.hnQuery', '"Copilot Chat" Microsoft'
)
WHERE slug = 'copilot-chat' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.hnQuery', '"Teams Premium"'
)
WHERE slug = 'teams-premium' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.hnQuery', '"Teams Phone" OR "Teams Calling"'
)
WHERE slug = 'teams-phone' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Microsoft_Loop',
  '$.wikipediaEstimated', json('false'),
  '$.hnQuery', '"Microsoft Loop"'
)
WHERE slug = 'microsoft-loop' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Microsoft_Planner',
  '$.wikipediaEstimated', json('false'),
  '$.hnQuery', '"Microsoft Planner"'
)
WHERE slug = 'microsoft-planner' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.hnQuery', '"Microsoft Lists"'
)
WHERE slug = 'microsoft-lists' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.hnQuery', '"SharePoint agents" OR "agents in SharePoint"'
)
WHERE slug = 'sharepoint-agents' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Microsoft_Intune',
  '$.wikipediaEstimated', json('false'),
  '$.hnQuery', '"Microsoft Intune"'
)
WHERE slug = 'microsoft-intune' AND json_valid(source_config_json);

UPDATE products
SET source_config_json = json_set(
  source_config_json,
  '$.wikipediaTitle', 'Microsoft_Entra_ID',
  '$.wikipediaEstimated', json('true'),
  '$.hnQuery', '"Microsoft Entra" OR "Entra ID"'
)
WHERE slug = 'microsoft-entra' AND json_valid(source_config_json);
