ALTER TABLE `merchants`
  MODIFY COLUMN `merchant_mode` ENUM('DISPLAY', 'MANAGED', 'DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER') NOT NULL DEFAULT 'DISPLAY';

ALTER TABLE `merchant_business_types`
  MODIFY COLUMN `default_merchant_mode` ENUM('DISPLAY', 'MANAGED', 'DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER') NOT NULL DEFAULT 'DISPLAY',
  ADD COLUMN `parent_id` BIGINT NULL,
  ADD COLUMN `level` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `path` VARCHAR(255) NULL,
  ADD INDEX `merchant_business_types_parent_id_sort_order_idx`(`parent_id`, `sort_order`);

ALTER TABLE `promotion_tags`
  ADD COLUMN `icon_text` VARCHAR(16) NULL,
  ADD COLUMN `color` VARCHAR(32) NULL,
  ADD COLUMN `description` VARCHAR(255) NULL;

ALTER TABLE `capabilities`
  ADD COLUMN `group_code` VARCHAR(32) NOT NULL DEFAULT 'DISPLAY',
  ADD COLUMN `group_name_zh` VARCHAR(80) NOT NULL DEFAULT '展示能力',
  ADD COLUMN `group_name_vi` VARCHAR(80) NULL,
  ADD COLUMN `group_name_en` VARCHAR(80) NULL;

CREATE TABLE `merchant_images` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `image_type` VARCHAR(32) NOT NULL,
  `image_url` VARCHAR(500) NOT NULL,
  `title_zh` VARCHAR(120) NULL,
  `title_vi` VARCHAR(120) NULL,
  `title_en` VARCHAR(120) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_visible` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `merchant_images_merchant_id_image_type_is_visible_sort_order_idx`(`merchant_id`, `image_type`, `is_visible`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `merchant_business_types`
  (`code`, `name_zh`, `name_vi`, `name_en`, `sort_order`, `show_on_home`, `enabled`, `default_merchant_mode`, `default_capabilities`, `level`, `path`)
SELECT 'FOOD_SERVICE', '餐饮美食', 'Am thuc', 'Food Service', 5, true, true, 'DISPLAY',
  JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true),
  1, 'FOOD_SERVICE'
WHERE NOT EXISTS (SELECT 1 FROM `merchant_business_types` WHERE `code` = 'FOOD_SERVICE');

UPDATE `merchant_business_types`
SET
  `parent_id` = (SELECT `id` FROM (SELECT `id` FROM `merchant_business_types` WHERE `code` = 'FOOD_SERVICE' LIMIT 1) AS `food_parent`),
  `level` = 2,
  `path` = CONCAT('FOOD_SERVICE/', `code`),
  `default_merchant_mode` = 'DISPLAY'
WHERE `code` IN ('CHINESE_RESTAURANT', 'NOODLE_SNACK', 'COFFEE_TEA', 'VIETNAMESE_FOOD');

UPDATE `merchant_business_types`
SET
  `level` = 1,
  `path` = `code`,
  `default_merchant_mode` = 'DISPLAY'
WHERE `code` IN ('FOOD_SERVICE', 'FLOWER_GIFT', 'FRUIT_FRESH', 'CONVENIENCE_MARKET');

UPDATE `promotion_tags`
SET `icon_text` = '🔥', `color` = '#16a34a', `description` = '平台手动推荐的热门美食'
WHERE `code` = 'HOT_FOOD';
UPDATE `promotion_tags`
SET `icon_text` = '⭐', `color` = '#2563eb', `description` = '首页重点推荐商家'
WHERE `code` = 'FEATURED';
UPDATE `promotion_tags`
SET `icon_text` = '🆕', `color` = '#22c55e', `description` = '新上线商家'
WHERE `code` = 'NEW_STORE';
UPDATE `promotion_tags`
SET `icon_text` = '📍', `color` = '#f97316', `description` = '附近热门商家'
WHERE `code` = 'POPULAR_NEARBY';
UPDATE `promotion_tags`
SET `icon_text` = '✓', `color` = '#7c3aed', `description` = '编辑精选商家'
WHERE `code` = 'EDITOR_PICK';

UPDATE `capabilities`
SET `group_code` = 'DISPLAY', `group_name_zh` = '展示能力', `group_name_vi` = 'Hien thi', `group_name_en` = 'Display'
WHERE `code` IN ('phoneEnabled', 'navigationEnabled', 'imageGalleryEnabled');
UPDATE `capabilities`
SET `group_code` = 'PRODUCT', `group_name_zh` = '商品能力', `group_name_vi` = 'San pham', `group_name_en` = 'Product'
WHERE `code` IN ('productDisplayEnabled');
UPDATE `capabilities`
SET `group_code` = 'ORDER', `group_name_zh` = '订单能力', `group_name_vi` = 'Don hang', `group_name_en` = 'Order'
WHERE `code` IN ('onlineOrderEnabled', 'pickupEnabled', 'deliveryEnabled', 'chatEnabled');
UPDATE `capabilities`
SET `group_code` = 'RESTAURANT', `group_name_zh` = '餐厅能力', `group_name_vi` = 'Nha hang', `group_name_en` = 'Restaurant'
WHERE `code` IN ('qrOrderEnabled', 'tableManagementEnabled', 'printerEnabled', 'voiceNotifyEnabled');
UPDATE `capabilities`
SET `group_code` = 'OPERATION', `group_name_zh` = '经营能力', `group_name_vi` = 'Van hanh', `group_name_en` = 'Operation'
WHERE `code` IN ('zaloReportEnabled');

UPDATE `merchants`
SET `merchant_mode` = CASE
  WHEN `merchant_mode` = 'DISPLAY_ONLY' THEN 'DISPLAY'
  WHEN `merchant_mode` IN ('PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER') THEN 'MANAGED'
  ELSE `merchant_mode`
END;

INSERT INTO `merchant_images` (`merchant_id`, `image_type`, `image_url`, `title_zh`, `sort_order`, `is_visible`)
SELECT `id`, 'LOGO', `logo_url`, 'Logo', 0, true
FROM `merchants`
WHERE `logo_url` IS NOT NULL AND TRIM(`logo_url`) <> '';

INSERT INTO `merchant_images` (`merchant_id`, `image_type`, `image_url`, `title_zh`, `sort_order`, `is_visible`)
SELECT `id`, 'COVER', `cover_url`, '封面图', 1, true
FROM `merchants`
WHERE `cover_url` IS NOT NULL AND TRIM(`cover_url`) <> '';

ALTER TABLE `merchant_business_types`
  ADD CONSTRAINT `merchant_business_types_parent_id_fkey`
  FOREIGN KEY (`parent_id`) REFERENCES `merchant_business_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `merchant_images`
  ADD CONSTRAINT `merchant_images_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
