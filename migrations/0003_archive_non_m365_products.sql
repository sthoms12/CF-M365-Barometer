-- Revamp (2026-09-30): keep the catalog strictly Microsoft 365.
-- Archive the adjacent-ecosystem products (Loop, Entra, Intune).
-- Archived products are hidden from the public catalog (is_active = 0)
-- and excluded from scheduled analysis runs. History is preserved and
-- this is reversible: set is_active = 1 and lifecycle_status = 'active'
-- to restore.
--
-- Wrangler applies equal numeric prefixes in filename order, so this file
-- runs before 0003_product_validation.sql. That file adds
-- products.lifecycle_status; assigning the column here fails a fresh
-- database with "no such column". Live already has this migration name in
-- d1_migrations (it ran after the column existed) and will not run this
-- body again.
--
-- On a fresh database the column is added next, with DEFAULT 'active'.
-- These three products stay hidden because is_active is 0.

UPDATE products
SET is_active = 0
WHERE slug IN ('microsoft-loop', 'microsoft-entra', 'microsoft-intune');
