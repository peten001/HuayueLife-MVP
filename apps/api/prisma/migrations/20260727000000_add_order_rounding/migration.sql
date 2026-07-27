ALTER TABLE `orders`
  ADD COLUMN `rounding_amount_vnd` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN `rounding_applied_by_staff_id` BIGINT NULL,
  ADD COLUMN `rounding_applied_at` DATETIME(3) NULL;

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_rounding_applied_by_staff_id_fkey`
  FOREIGN KEY (`rounding_applied_by_staff_id`) REFERENCES `merchant_staff`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `orders_rounding_applied_by_staff_id_idx`
  ON `orders`(`rounding_applied_by_staff_id`);
