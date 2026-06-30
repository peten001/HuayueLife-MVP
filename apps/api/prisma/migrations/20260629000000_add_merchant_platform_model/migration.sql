CREATE TABLE `merchant_business_types` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `name_zh` VARCHAR(80) NOT NULL,
  `name_vi` VARCHAR(80) NULL,
  `name_en` VARCHAR(80) NULL,
  `icon_url` VARCHAR(500) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `show_on_home` BOOLEAN NOT NULL DEFAULT true,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `default_merchant_mode` ENUM('DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER') NOT NULL DEFAULT 'DISPLAY_ONLY',
  `default_capabilities` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `merchant_business_types_code_key`(`code`),
  INDEX `merchant_business_types_enabled_show_on_home_sort_order_idx`(`enabled`, `show_on_home`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `promotion_tags` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `name_zh` VARCHAR(80) NOT NULL,
  `name_vi` VARCHAR(80) NULL,
  `name_en` VARCHAR(80) NULL,
  `icon_url` VARCHAR(500) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `promotion_tags_code_key`(`code`),
  INDEX `promotion_tags_enabled_sort_order_idx`(`enabled`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `capabilities` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `name_zh` VARCHAR(80) NOT NULL,
  `name_vi` VARCHAR(80) NULL,
  `name_en` VARCHAR(80) NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `default_value` BOOLEAN NOT NULL DEFAULT false,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `capabilities_code_key`(`code`),
  INDEX `capabilities_enabled_sort_order_idx`(`enabled`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchants`
  ADD COLUMN `business_type_id` BIGINT NULL,
  ADD COLUMN `name_en` VARCHAR(120) NULL,
  ADD COLUMN `merchant_mode` ENUM('DISPLAY_ONLY', 'PRODUCT_DISPLAY', 'ONLINE_ORDER', 'QR_ORDER') NOT NULL DEFAULT 'DISPLAY_ONLY',
  ADD COLUMN `claim_status` ENUM('UNCLAIMED', 'CLAIMED') NOT NULL DEFAULT 'UNCLAIMED',
  ADD COLUMN `owner_user_id` BIGINT NULL,
  ADD COLUMN `address_zh` VARCHAR(255) NULL,
  ADD COLUMN `address_vi` VARCHAR(255) NULL,
  ADD COLUMN `address_en` VARCHAR(255) NULL,
  ADD COLUMN `opening_hours_text` VARCHAR(255) NULL,
  ADD COLUMN `description_zh` TEXT NULL,
  ADD COLUMN `description_vi` TEXT NULL,
  ADD COLUMN `description_en` TEXT NULL,
  ADD COLUMN `sort_order` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `is_new` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `recommended_at` DATETIME(3) NULL;

CREATE TABLE `merchant_promotion_tags` (
  `merchant_id` BIGINT NOT NULL,
  `promotion_tag_id` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `merchant_promotion_tags_promotion_tag_id_idx`(`promotion_tag_id`),
  PRIMARY KEY (`merchant_id`, `promotion_tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `merchant_capabilities` (
  `merchant_id` BIGINT NOT NULL,
  `capability_id` BIGINT NOT NULL,
  `is_enabled` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX `merchant_capabilities_capability_id_idx`(`capability_id`),
  PRIMARY KEY (`merchant_id`, `capability_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `merchant_business_types`
  (`code`, `name_zh`, `name_vi`, `name_en`, `sort_order`, `show_on_home`, `enabled`, `default_merchant_mode`, `default_capabilities`)
VALUES
  ('CHINESE_RESTAURANT', '中式正餐', 'Nha hang Trung Hoa', 'Chinese Restaurant', 10, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('NOODLE_SNACK', '粉面小吃', 'Mi va do an vat', 'Noodles & Snacks', 20, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('COFFEE_TEA', '咖啡奶茶', 'Ca phe va tra sua', 'Coffee & Tea', 30, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('FLOWER_GIFT', '鲜花礼品', 'Hoa va qua tang', 'Flowers & Gifts', 40, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('FRUIT_FRESH', '水果生鲜', 'Trai cay tuoi song', 'Fresh Fruit', 50, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('CONVENIENCE_MARKET', '便利超市', 'Cua hang tien loi', 'Convenience Market', 60, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true)),
  ('VIETNAMESE_FOOD', '特色越餐', 'Mon Viet dac sac', 'Vietnamese Food', 70, true, true, 'DISPLAY_ONLY', JSON_OBJECT('phoneEnabled', true, 'navigationEnabled', true, 'imageGalleryEnabled', true));

INSERT INTO `promotion_tags`
  (`code`, `name_zh`, `name_vi`, `name_en`, `sort_order`, `enabled`)
VALUES
  ('HOT_FOOD', '热门美食', 'Mon ngon pho bien', 'Hot Food', 10, true),
  ('FEATURED', '首页推荐', 'De xuat trang chu', 'Featured', 20, true),
  ('NEW_STORE', '新店推荐', 'Cua hang moi', 'New Store', 30, true),
  ('POPULAR_NEARBY', '附近热门', 'Pho bien gan day', 'Popular Nearby', 40, true),
  ('EDITOR_PICK', '编辑精选', 'Bien tap chon', 'Editor Pick', 50, true);

INSERT INTO `capabilities`
  (`code`, `name_zh`, `name_vi`, `name_en`, `enabled`, `default_value`, `sort_order`)
VALUES
  ('phoneEnabled', '电话', 'Dien thoai', 'Phone', true, true, 10),
  ('navigationEnabled', '导航', 'Chi duong', 'Navigation', true, true, 20),
  ('imageGalleryEnabled', '图片/相册展示', 'Thu vien anh', 'Image Gallery', true, true, 30),
  ('productDisplayEnabled', '商品展示', 'Hien thi san pham', 'Product Display', true, false, 40),
  ('onlineOrderEnabled', '在线下单', 'Dat hang online', 'Online Order', true, false, 50),
  ('pickupEnabled', '到店自取', 'Tu lay tai cua hang', 'Pickup', true, false, 60),
  ('deliveryEnabled', '商家配送', 'Giao hang boi cua hang', 'Merchant Delivery', true, false, 70),
  ('qrOrderEnabled', '扫码点餐', 'Quet ma dat mon', 'QR Order', true, false, 80),
  ('tableManagementEnabled', '桌台管理', 'Quan ly ban', 'Table Management', true, false, 90),
  ('printerEnabled', '打印机', 'May in', 'Printer', true, false, 100),
  ('zaloReportEnabled', 'Zalo 日报', 'Bao cao Zalo', 'Zalo Report', true, false, 110),
  ('chatEnabled', '订单聊天', 'Chat don hang', 'Order Chat', true, false, 120),
  ('voiceNotifyEnabled', '语音播报', 'Thong bao giong noi', 'Voice Notify', true, false, 130);

UPDATE `merchants`
SET
  `business_type_id` = (SELECT `id` FROM `merchant_business_types` WHERE `code` = 'CHINESE_RESTAURANT' LIMIT 1),
  `merchant_mode` = 'QR_ORDER',
  `claim_status` = 'CLAIMED',
  `address_zh` = `address_detail`,
  `opening_hours_text` = '10:00-22:00'
WHERE `business_type_id` IS NULL;

INSERT INTO `merchant_capabilities` (`merchant_id`, `capability_id`, `is_enabled`)
SELECT `m`.`id`, `c`.`id`,
  CASE
    WHEN `c`.`code` IN ('phoneEnabled', 'navigationEnabled', 'imageGalleryEnabled', 'productDisplayEnabled', 'onlineOrderEnabled', 'pickupEnabled', 'qrOrderEnabled', 'tableManagementEnabled', 'chatEnabled', 'voiceNotifyEnabled') THEN true
    WHEN `c`.`code` = 'deliveryEnabled' THEN `m`.`delivery_enabled`
    WHEN `c`.`code` = 'printerEnabled' THEN EXISTS(SELECT 1 FROM `printer_settings` `p` WHERE `p`.`merchant_id` = `m`.`id`)
    WHEN `c`.`code` = 'zaloReportEnabled' THEN `m`.`report_feature_enabled`
    ELSE false
  END
FROM `merchants` `m`
CROSS JOIN `capabilities` `c`;

CREATE INDEX `merchants_business_type_id_status_idx` ON `merchants`(`business_type_id`, `status`);
CREATE INDEX `merchants_merchant_mode_status_idx` ON `merchants`(`merchant_mode`, `status`);
CREATE INDEX `merchants_sort_order_idx` ON `merchants`(`sort_order`);
CREATE INDEX `merchants_owner_user_id_idx` ON `merchants`(`owner_user_id`);

ALTER TABLE `merchants`
  ADD CONSTRAINT `merchants_business_type_id_fkey`
  FOREIGN KEY (`business_type_id`) REFERENCES `merchant_business_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `merchants_owner_user_id_fkey`
  FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `merchant_promotion_tags`
  ADD CONSTRAINT `merchant_promotion_tags_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `merchant_promotion_tags_promotion_tag_id_fkey`
  FOREIGN KEY (`promotion_tag_id`) REFERENCES `promotion_tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `merchant_capabilities`
  ADD CONSTRAINT `merchant_capabilities_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `merchant_capabilities_capability_id_fkey`
  FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
