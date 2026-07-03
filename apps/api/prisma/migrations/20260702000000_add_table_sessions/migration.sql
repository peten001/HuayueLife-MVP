-- AlterTable
ALTER TABLE `orders` ADD COLUMN `table_session_id` BIGINT NULL;

-- CreateTable
CREATE TABLE `table_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `table_id` BIGINT NOT NULL,
    `open_table_id` BIGINT NULL,
    `session_no` VARCHAR(32) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `opened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `table_sessions_open_table_id_key`(`open_table_id`),
    UNIQUE INDEX `table_sessions_session_no_key`(`session_no`),
    INDEX `table_sessions_merchant_id_status_idx`(`merchant_id`, `status`),
    INDEX `table_sessions_table_id_opened_at_idx`(`table_id`, `opened_at`),
    INDEX `table_sessions_merchant_id_opened_at_idx`(`merchant_id`, `opened_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `orders_table_session_id_idx` ON `orders`(`table_session_id`);

-- AddForeignKey
ALTER TABLE `table_sessions` ADD CONSTRAINT `table_sessions_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `table_sessions` ADD CONSTRAINT `table_sessions_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_table_session_id_fkey` FOREIGN KEY (`table_session_id`) REFERENCES `table_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
