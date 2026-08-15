ALTER TABLE `products`
  ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `status`;

ALTER TABLE `orders`
  ADD COLUMN `business_date` DATE NULL AFTER `completed_at`,
  ADD COLUMN `payment_method` ENUM('CASH', 'BANK_TRANSFER') NULL AFTER `business_date`;

ALTER TABLE `table_sessions`
  ADD COLUMN `business_date` DATE NULL AFTER `closed_at`,
  ADD COLUMN `payment_method` ENUM('CASH', 'BANK_TRANSFER') NULL AFTER `business_date`;

CREATE INDEX `products_merchant_id_deleted_at_idx`
  ON `products`(`merchant_id`, `deleted_at`);

CREATE INDEX `orders_merchant_id_business_date_status_idx`
  ON `orders`(`merchant_id`, `business_date`, `status`);

CREATE INDEX `table_sessions_merchant_id_business_date_idx`
  ON `table_sessions`(`merchant_id`, `business_date`);
