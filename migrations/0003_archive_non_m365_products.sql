-- Revamp (2026-09-30): keep the catalog strictly Microsoft 365.
-- Archive the adjacent-ecosystem products (Loop, Entra, Intune).
-- Archived products are hidden from the public catalog (is_active = 0)
-- and excluded from scheduled analysis runs. History is preserved and
-- this is reversible: set is_active = 1 and lifecycle_status = 'active'
-- to restore.
UPDATE products
SET is_active = 0,
    lifecycle_status = 'archived'
WHERE slug IN ('microsoft-loop', 'microsoft-entra', 'microsoft-intune');
