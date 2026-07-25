ALTER TABLE `table_sessions`
  ADD COLUMN `rounding_amount_vnd` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `rounding_applied_by_staff_id` BIGINT NULL;
