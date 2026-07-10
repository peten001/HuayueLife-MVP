CREATE TABLE `platform_settings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `key` VARCHAR(120) NOT NULL,
  `value` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `platform_settings_key_key`(`key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
