-- Immutable opening-day snapshot. Keep legacy checkout business_date intact.
-- Legacy rows are resolved from opened_at until the explicit snapshot backfill.
ALTER TABLE `table_sessions`
  ADD COLUMN `opened_business_date` DATE NULL,
  ADD INDEX `ix_sessions_opened_business_date` (`merchant_id`, `opened_business_date`);
