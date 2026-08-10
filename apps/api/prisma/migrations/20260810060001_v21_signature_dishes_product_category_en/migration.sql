-- AlterTable
ALTER TABLE `categories` ADD COLUMN `name_en` VARCHAR(80) NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `name_en` VARCHAR(120) NULL;

-- CreateTable
CREATE TABLE `merchant_signature_dishes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name_zh` VARCHAR(120) NOT NULL,
    `name_vi` VARCHAR(120) NULL,
    `name_en` VARCHAR(120) NULL,
    `image_url` VARCHAR(500) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_visible` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `merchant_signature_dishes_merchant_id_is_visible_sort_order_idx`(`merchant_id`, `is_visible`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `merchant_signature_dishes` ADD CONSTRAINT `merchant_signature_dishes_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
