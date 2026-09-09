ALTER TABLE `merchant_reviews`
  MODIFY `order_id` BIGINT NULL,
  ADD COLUMN `source` ENUM('ORDER', 'DIRECT') NOT NULL DEFAULT 'ORDER' AFTER `merchant_id`,
  ADD COLUMN `direct_review_key` VARCHAR(191) NULL AFTER `source`,
  ADD UNIQUE INDEX `merchant_reviews_direct_review_key_key`(`direct_review_key`),
  ADD INDEX `merchant_reviews_merchant_id_source_status_created_at_idx`(`merchant_id`, `source`, `status`, `created_at`);
