CREATE TABLE `cashier_push_subscriptions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `staff_id` BIGINT NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `endpoint` TEXT NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `locale` VARCHAR(8) NOT NULL DEFAULT 'zh',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `cashier_push_subscriptions_endpoint_hash_key`(`endpoint_hash`),
  INDEX `cashier_push_subscriptions_merchant_id_idx`(`merchant_id`),
  INDEX `cashier_push_subscriptions_staff_id_idx`(`staff_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cashier_push_deliveries` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `subscription_id` BIGINT NOT NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lease_until` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `resolved_at` DATETIME(3) NULL,
  `last_error` VARCHAR(120) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `cashier_push_deliveries_order_id_subscription_id_key`(`order_id`, `subscription_id`),
  INDEX `cashier_push_deliveries_sent_at_resolved_at_next_attempt_at_idx`(`sent_at`, `resolved_at`, `next_attempt_at`),
  INDEX `cashier_push_deliveries_subscription_id_idx`(`subscription_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cashier_push_events` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `lease_until` DATETIME(3) NULL,
  `processed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `cashier_push_events_order_id_key`(`order_id`),
  INDEX `cashier_push_events_processed_at_created_at_idx`(`processed_at`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cashier_push_subscriptions`
  ADD CONSTRAINT `cashier_push_subscriptions_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `cashier_push_subscriptions_staff_id_fkey`
    FOREIGN KEY (`staff_id`) REFERENCES `merchant_staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `cashier_push_deliveries`
  ADD CONSTRAINT `cashier_push_deliveries_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `cashier_push_deliveries_subscription_id_fkey`
    FOREIGN KEY (`subscription_id`) REFERENCES `cashier_push_subscriptions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `cashier_push_events`
  ADD CONSTRAINT `cashier_push_events_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
