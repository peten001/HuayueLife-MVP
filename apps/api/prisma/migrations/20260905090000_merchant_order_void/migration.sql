-- Additive soft-void metadata. Original fulfillment, payment and receipt facts remain intact.
ALTER TABLE `orders`
  ADD COLUMN `voided_at` DATETIME(3) NULL,
  ADD COLUMN `voided_by_staff_id` BIGINT NULL,
  ADD COLUMN `void_reason` VARCHAR(32) NULL,
  ADD COLUMN `void_reason_note` VARCHAR(255) NULL,
  ADD COLUMN `void_operation_id` VARCHAR(36) NULL,
  ADD INDEX `ix_orders_effective_date` (`merchant_id`, `voided_at`, `business_date`),
  ADD INDEX `ix_orders_void_operation` (`merchant_id`, `void_operation_id`);
ALTER TABLE `table_sessions`
  ADD COLUMN `voided_at` DATETIME(3) NULL,
  ADD COLUMN `voided_by_staff_id` BIGINT NULL,
  ADD COLUMN `void_reason` VARCHAR(32) NULL,
  ADD COLUMN `void_reason_note` VARCHAR(255) NULL,
  ADD COLUMN `void_operation_id` VARCHAR(36) NULL,
  ADD INDEX `ix_sessions_effective_date` (`merchant_id`, `voided_at`, `business_date`);
