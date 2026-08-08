ALTER TABLE `orders`
  ADD COLUMN `discount_payable_rate_bps` INTEGER NULL,
  ADD COLUMN `discount_amount_vnd` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `discount_applied_by_staff_id` BIGINT NULL,
  ADD COLUMN `discount_applied_at` DATETIME(3) NULL;

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_discount_applied_by_staff_id_fkey`
  FOREIGN KEY (`discount_applied_by_staff_id`) REFERENCES `merchant_staff`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `orders_discount_applied_by_staff_id_idx`
  ON `orders`(`discount_applied_by_staff_id`);

ALTER TABLE `table_sessions`
  ADD COLUMN `discount_payable_rate_bps` INTEGER NULL,
  ADD COLUMN `discount_amount_vnd` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `discount_applied_by_staff_id` BIGINT NULL,
  ADD COLUMN `discount_applied_at` DATETIME(3) NULL;
