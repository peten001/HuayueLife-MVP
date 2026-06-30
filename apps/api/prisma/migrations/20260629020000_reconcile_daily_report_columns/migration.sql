-- Reconcile local databases that already had daily-report tables created with
-- older column names. This keeps existing data and adds the columns expected by
-- the current Prisma schema and services.

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_report_settings'
    AND COLUMN_NAME = 'enabled'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `merchant_report_settings` ADD COLUMN `enabled` BOOLEAN NOT NULL DEFAULT false AFTER `merchant_id`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_report_settings'
    AND COLUMN_NAME = 'zalo_recipient'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `merchant_report_settings` ADD COLUMN `zalo_recipient` VARCHAR(120) NULL AFTER `enabled`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_report_settings'
    AND COLUMN_NAME = 'push_time'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `merchant_report_settings` ADD COLUMN `push_time` VARCHAR(5) NOT NULL DEFAULT ''22:00'' AFTER `zalo_recipient`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_report_settings'
    AND COLUMN_NAME = 'ai_suggestions'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `merchant_report_settings` ADD COLUMN `ai_suggestions` BOOLEAN NOT NULL DEFAULT false AFTER `language`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @legacy_column_count := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'merchant_report_settings'
    AND COLUMN_NAME IN (
      'daily_report_enabled',
      'zalo_recipient_id',
      'send_time',
      'ai_suggestion_enabled'
    )
);
SET @sql := IF(
  @legacy_column_count = 4,
  'UPDATE `merchant_report_settings`
   SET
     `enabled` = COALESCE(`daily_report_enabled`, `enabled`),
     `zalo_recipient` = COALESCE(`zalo_recipient`, `zalo_recipient_id`),
     `push_time` = COALESCE(`send_time`, `push_time`),
     `ai_suggestions` = COALESCE(`ai_suggestion_enabled`, `ai_suggestions`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'language'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `language` VARCHAR(8) NOT NULL DEFAULT ''zh'' AFTER `report_date`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'channel'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `channel` VARCHAR(32) NOT NULL DEFAULT ''zalo'' AFTER `language`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'recipient'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `recipient` VARCHAR(120) NULL AFTER `channel`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'status'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT ''PENDING'' AFTER `recipient`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'mocked'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `mocked` BOOLEAN NOT NULL DEFAULT true AFTER `status`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME = 'summary_json'
);
SET @sql := IF(
  @column_exists = 0,
  'ALTER TABLE `daily_report_logs` ADD COLUMN `summary_json` JSON NULL AFTER `report_image_url`',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @legacy_column_count := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'daily_report_logs'
    AND COLUMN_NAME IN ('send_channel', 'send_status')
);
SET @sql := IF(
  @legacy_column_count = 2,
  'UPDATE `daily_report_logs`
   SET
     `channel` = LOWER(COALESCE(`send_channel`, `channel`)),
     `status` = COALESCE(`send_status`, `status`)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
