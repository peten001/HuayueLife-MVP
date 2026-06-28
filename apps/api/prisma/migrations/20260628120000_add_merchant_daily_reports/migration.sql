-- AlterTable
ALTER TABLE `merchants`
  ADD COLUMN `report_feature_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `merchant_report_settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `zalo_recipient` VARCHAR(120) NULL,
  `push_time` VARCHAR(5) NOT NULL DEFAULT '22:00',
  `language` VARCHAR(8) NOT NULL DEFAULT 'zh',
  `ai_suggestions` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `merchant_report_settings_merchant_id_key`(`merchant_id`),
  CONSTRAINT `merchant_report_settings_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_report_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `report_date` DATE NOT NULL,
  `language` VARCHAR(8) NOT NULL DEFAULT 'zh',
  `channel` VARCHAR(32) NOT NULL DEFAULT 'zalo',
  `recipient` VARCHAR(120) NULL,
  `status` VARCHAR(16) NOT NULL,
  `mocked` BOOLEAN NOT NULL DEFAULT true,
  `report_image_url` VARCHAR(500) NULL,
  `summary_json` JSON NULL,
  `error_message` VARCHAR(500) NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `daily_report_logs_merchant_id_report_date_idx`(`merchant_id`, `report_date`),
  CONSTRAINT `daily_report_logs_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
