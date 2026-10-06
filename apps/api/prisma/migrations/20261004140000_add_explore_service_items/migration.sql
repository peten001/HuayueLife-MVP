-- AlterTable
ALTER TABLE `merchants` MODIFY `merchant_type` ENUM('RESTAURANT', 'MILK_TEA', 'FRUIT', 'FLOWER', 'CAKE', 'SERVICE', 'RETAIL') NOT NULL DEFAULT 'RESTAURANT';

-- CreateTable
CREATE TABLE `merchant_service_items` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name_zh` VARCHAR(120) NOT NULL,
    `name_vi` VARCHAR(120) NULL,
    `name_en` VARCHAR(120) NULL,
    `description_zh` VARCHAR(500) NULL,
    `description_vi` VARCHAR(500) NULL,
    `description_en` VARCHAR(500) NULL,
    `image_url` VARCHAR(500) NULL,
    `duration_minutes` INTEGER NULL,
    `price_mode` VARCHAR(16) NOT NULL DEFAULT 'INQUIRY',
    `amount_vnd` BIGINT NULL,
    `unit` VARCHAR(32) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `merchant_service_items_merchant_id_is_visible_sort_order_idx`(`merchant_id`, `is_visible`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchant_service_items` ADD CONSTRAINT `merchant_service_items_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

