-- AlterTable
ALTER TABLE `orders` ADD COLUMN `kds_packed_at` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `kds_settings` (
    `merchant_id` BIGINT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `activated_at` DATETIME(3) NULL,
    `timeout_minutes` INTEGER NOT NULL DEFAULT 15,
    `stations` JSON NOT NULL,
    `category_routes` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`merchant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kds_tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `order_id` BIGINT NOT NULL,
    `order_item_id` BIGINT NOT NULL,
    `product_id` BIGINT NULL,
    `category_id` BIGINT NULL,
    `dish_name` VARCHAR(120) NOT NULL,
    `remark` VARCHAR(200) NULL,
    `station` VARCHAR(40) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `made_quantity` INTEGER NOT NULL DEFAULT 0,
    `served_quantity` INTEGER NOT NULL DEFAULT 0,
    `cancelled_quantity` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `started_at` DATETIME(3) NULL,
    `urgent_at` DATETIME(3) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `kds_tasks_merchant_id_resolved_at_created_at_idx`(`merchant_id`, `resolved_at`, `created_at`),
    INDEX `kds_tasks_order_id_idx`(`order_id`),
    UNIQUE INDEX `kds_tasks_merchant_id_order_item_id_key`(`merchant_id`, `order_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `kds_operations` (
    `id` VARCHAR(36) NOT NULL,
    `merchant_id` BIGINT NOT NULL,
    `staff_id` BIGINT NULL,
    `request_key` VARCHAR(80) NOT NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `lines` JSON NOT NULL,
    `reversed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `kds_operations_merchant_id_created_at_idx`(`merchant_id`, `created_at`),
    UNIQUE INDEX `kds_operations_merchant_id_request_key_key`(`merchant_id`, `request_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `kds_settings` ADD CONSTRAINT `kds_settings_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kds_tasks` ADD CONSTRAINT `kds_tasks_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kds_tasks` ADD CONSTRAINT `kds_tasks_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `kds_operations` ADD CONSTRAINT `kds_operations_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

