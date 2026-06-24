CREATE TABLE `printer_settings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `type` ENUM('NETWORK') NOT NULL DEFAULT 'NETWORK',
    `usage_type` ENUM('FRONT_DESK', 'KITCHEN', 'BAR', 'GENERAL') NOT NULL DEFAULT 'GENERAL',
    `encoding` ENUM('UTF8', 'GBK', 'CP1258') NOT NULL DEFAULT 'UTF8',
    `ip_address` VARCHAR(64) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 9100,
    `paper_width` ENUM('WIDTH_58', 'WIDTH_80') NOT NULL DEFAULT 'WIDTH_80',
    `copies` INTEGER NOT NULL DEFAULT 1,
    `language` ENUM('zh', 'vi', 'en') NOT NULL DEFAULT 'zh',
    `auto_print_enabled` BOOLEAN NOT NULL DEFAULT true,
    `is_default` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('UNKNOWN', 'ONLINE', 'OFFLINE') NOT NULL DEFAULT 'UNKNOWN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `printer_settings_merchant_id_is_default_idx`(`merchant_id`, `is_default`),
    INDEX `printer_settings_merchant_id_status_idx`(`merchant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `print_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `printer_id` BIGINT NULL,
    `status` ENUM('PENDING', 'PRINTING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `error_message` VARCHAR(500) NULL,
    `printed_by` ENUM('SYSTEM', 'MERCHANT') NOT NULL DEFAULT 'SYSTEM',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `print_logs_merchant_id_created_at_idx`(`merchant_id`, `created_at`),
    INDEX `print_logs_order_id_created_at_idx`(`order_id`, `created_at`),
    INDEX `print_logs_printer_id_created_at_idx`(`printer_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `printer_settings`
    ADD CONSTRAINT `printer_settings_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `print_logs`
    ADD CONSTRAINT `print_logs_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `print_logs`
    ADD CONSTRAINT `print_logs_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `print_logs`
    ADD CONSTRAINT `print_logs_printer_id_fkey`
    FOREIGN KEY (`printer_id`) REFERENCES `printer_settings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
