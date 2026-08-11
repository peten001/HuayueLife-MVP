-- Additive system marker for the one merchant-owned signature-dish category.
-- Existing rows remain ordinary categories until the explicit, audited backfill runs.
ALTER TABLE `categories`
  ADD COLUMN `is_signature` BOOLEAN NOT NULL DEFAULT false;
