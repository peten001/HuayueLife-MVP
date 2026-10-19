-- AlterTable
ALTER TABLE `merchants` ADD COLUMN `dine_in_reservation_enabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pickup_reservation_enabled` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `is_reservation` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `proposed_scheduled_for` DATETIME(3) NULL,
    ADD COLUMN `scheduled_for` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `cashier_push_deliveries` ADD COLUMN `reservation_id` BIGINT NULL,
    MODIFY `order_id` BIGINT NULL;

-- AlterTable
ALTER TABLE `cashier_push_events` ADD COLUMN `reservation_id` BIGINT NULL,
    MODIFY `order_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `dining_reservations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reservation_no` VARCHAR(32) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `merchant_id` BIGINT NOT NULL,
    `idempotency_key` VARCHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'PENDING',
    `scheduled_for` DATETIME(3) NOT NULL,
    `proposed_scheduled_for` DATETIME(3) NULL,
    `guest_count` INTEGER NOT NULL,
    `contact_name` VARCHAR(64) NOT NULL,
    `contact_phone` VARCHAR(32) NOT NULL,
    `customer_remark` VARCHAR(500) NULL,
    `items` JSON NOT NULL,
    `item_amount_vnd` BIGINT NOT NULL DEFAULT 0,
    `audit` JSON NOT NULL,
    `confirmed_at` DATETIME(3) NULL,
    `seated_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `order_id` BIGINT NULL,
    `table_session_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dining_reservations_reservation_no_key`(`reservation_no`),
    UNIQUE INDEX `dining_reservations_order_id_key`(`order_id`),
    INDEX `dining_reservations_merchant_id_status_scheduled_for_idx`(`merchant_id`, `status`, `scheduled_for`),
    INDEX `dining_reservations_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `dining_reservations_table_session_id_idx`(`table_session_id`),
    UNIQUE INDEX `dining_reservations_user_id_idempotency_key_key`(`user_id`, `idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `orders_merchant_id_is_reservation_scheduled_for_idx` ON `orders`(`merchant_id`, `is_reservation`, `scheduled_for`);

-- CreateIndex
CREATE UNIQUE INDEX `cashier_push_deliveries_reservation_id_subscription_id_key` ON `cashier_push_deliveries`(`reservation_id`, `subscription_id`);

-- CreateIndex
CREATE UNIQUE INDEX `cashier_push_events_reservation_id_key` ON `cashier_push_events`(`reservation_id`);

-- AddForeignKey
ALTER TABLE `cashier_push_deliveries` ADD CONSTRAINT `cashier_push_deliveries_reservation_id_fkey` FOREIGN KEY (`reservation_id`) REFERENCES `dining_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cashier_push_events` ADD CONSTRAINT `cashier_push_events_reservation_id_fkey` FOREIGN KEY (`reservation_id`) REFERENCES `dining_reservations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dining_reservations` ADD CONSTRAINT `dining_reservations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dining_reservations` ADD CONSTRAINT `dining_reservations_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dining_reservations` ADD CONSTRAINT `dining_reservations_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dining_reservations` ADD CONSTRAINT `dining_reservations_table_session_id_fkey` FOREIGN KEY (`table_session_id`) REFERENCES `table_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
