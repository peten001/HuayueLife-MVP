CREATE TABLE `users` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `openid` VARCHAR(64) NOT NULL,
  `unionid` VARCHAR(64) NULL,
  `nickname` VARCHAR(64) NULL,
  `avatar_url` VARCHAR(500) NULL,
  `phone` VARCHAR(32) NULL,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `users_openid_key`(`openid`),
  UNIQUE INDEX `users_unionid_key`(`unionid`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `merchants` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name_zh` VARCHAR(120) NOT NULL,
  `name_vi` VARCHAR(120) NULL,
  `merchant_type` ENUM('RESTAURANT', 'MILK_TEA', 'FRUIT', 'FLOWER', 'CAKE') NOT NULL DEFAULT 'RESTAURANT',
  `logo_url` VARCHAR(500) NULL,
  `cover_url` VARCHAR(500) NULL,
  `contact_name` VARCHAR(64) NOT NULL,
  `contact_phone` VARCHAR(32) NOT NULL,
  `province` VARCHAR(80) NOT NULL,
  `city` VARCHAR(80) NOT NULL,
  `district` VARCHAR(80) NULL,
  `address_detail` VARCHAR(255) NOT NULL,
  `latitude` DECIMAL(10, 7) NOT NULL,
  `longitude` DECIMAL(10, 7) NOT NULL,
  `business_hours` JSON NOT NULL,
  `notice` TEXT NULL,
  `minimum_delivery_amount_vnd` BIGINT NOT NULL DEFAULT 0,
  `delivery_fee_vnd` BIGINT NOT NULL DEFAULT 0,
  `delivery_radius_km` DECIMAL(5, 2) NOT NULL DEFAULT 0,
  `dine_in_enabled` BOOLEAN NOT NULL DEFAULT true,
  `pickup_enabled` BOOLEAN NOT NULL DEFAULT true,
  `delivery_enabled` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('DRAFT', 'ACTIVE', 'CLOSED', 'DISABLED') NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `merchants_status_idx`(`status`),
  INDEX `merchants_province_city_status_idx`(`province`, `city`, `status`),
  INDEX `merchants_latitude_longitude_idx`(`latitude`, `longitude`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `merchant_staff` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(64) NOT NULL,
  `role` ENUM('OWNER', 'MANAGER', 'STAFF') NOT NULL DEFAULT 'STAFF',
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `merchant_staff_merchant_id_username_key`(`merchant_id`, `username`),
  INDEX `merchant_staff_merchant_id_status_idx`(`merchant_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `categories` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `name_zh` VARCHAR(80) NOT NULL,
  `name_vi` VARCHAR(80) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `categories_merchant_id_is_active_sort_order_idx`(`merchant_id`, `is_active`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `products` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `category_id` BIGINT NOT NULL,
  `name_zh` VARCHAR(120) NOT NULL,
  `name_vi` VARCHAR(120) NULL,
  `product_type` ENUM('FOOD', 'DRINK', 'FRUIT', 'FLOWER', 'CAKE') NOT NULL DEFAULT 'FOOD',
  `description` TEXT NULL,
  `image_url` VARCHAR(500) NULL,
  `price_vnd` BIGINT NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('DRAFT', 'ON_SALE', 'SOLD_OUT', 'OFF_SALE') NOT NULL DEFAULT 'DRAFT',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `products_merchant_id_category_id_status_sort_order_idx`(`merchant_id`, `category_id`, `status`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `dining_tables` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `merchant_id` BIGINT NOT NULL,
  `table_no` VARCHAR(32) NOT NULL,
  `table_name` VARCHAR(64) NULL,
  `qr_token` VARCHAR(64) NOT NULL,
  `qr_version` INTEGER NOT NULL DEFAULT 1,
  `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `dining_tables_qr_token_key`(`qr_token`),
  UNIQUE INDEX `dining_tables_merchant_id_table_no_key`(`merchant_id`, `table_no`),
  INDEX `dining_tables_merchant_id_status_idx`(`merchant_id`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `carts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `merchant_id` BIGINT NOT NULL,
  `table_id` BIGINT NULL,
  `order_type` ENUM('DINE_IN', 'PICKUP', 'DELIVERY') NOT NULL,
  `status` ENUM('ACTIVE', 'CHECKED_OUT', 'ABANDONED') NOT NULL DEFAULT 'ACTIVE',
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `carts_user_id_merchant_id_order_type_status_idx`(`user_id`, `merchant_id`, `order_type`, `status`),
  INDEX `carts_expires_at_idx`(`expires_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `cart_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `cart_id` BIGINT NOT NULL,
  `product_id` BIGINT NOT NULL,
  `quantity` INTEGER NOT NULL,
  `remark` VARCHAR(200) NOT NULL DEFAULT '',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `cart_items_cart_id_product_id_remark_key`(`cart_id`, `product_id`, `remark`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `orders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_no` VARCHAR(32) NOT NULL,
  `user_id` BIGINT NOT NULL,
  `merchant_id` BIGINT NOT NULL,
  `table_id` BIGINT NULL,
  `table_no_snapshot` VARCHAR(32) NULL,
  `order_type` ENUM('DINE_IN', 'PICKUP', 'DELIVERY') NOT NULL,
  `status` ENUM('PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
  `contact_name` VARCHAR(64) NULL,
  `contact_phone` VARCHAR(32) NULL,
  `delivery_address` VARCHAR(255) NULL,
  `delivery_latitude` DECIMAL(10, 7) NULL,
  `delivery_longitude` DECIMAL(10, 7) NULL,
  `customer_remark` VARCHAR(500) NULL,
  `item_amount_vnd` BIGINT NOT NULL,
  `delivery_fee_vnd` BIGINT NOT NULL DEFAULT 0,
  `total_amount_vnd` BIGINT NOT NULL,
  `settlement_status` ENUM('UNSETTLED', 'SETTLED') NOT NULL DEFAULT 'UNSETTLED',
  `accepted_at` DATETIME(3) NULL,
  `ready_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `cancel_reason` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `orders_order_no_key`(`order_no`),
  INDEX `orders_merchant_id_status_created_at_idx`(`merchant_id`, `status`, `created_at`),
  INDEX `orders_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `product_id` BIGINT NULL,
  `product_name_zh_snapshot` VARCHAR(120) NOT NULL,
  `image_url_snapshot` VARCHAR(500) NULL,
  `unit_price_vnd` BIGINT NOT NULL,
  `quantity` INTEGER NOT NULL,
  `subtotal_vnd` BIGINT NOT NULL,
  `remark` VARCHAR(200) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `order_items_order_id_idx`(`order_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_status_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `from_status` ENUM('PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED') NULL,
  `to_status` ENUM('PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED') NOT NULL,
  `operator_type` ENUM('USER', 'MERCHANT_STAFF', 'SYSTEM') NOT NULL,
  `operator_user_id` BIGINT NULL,
  `operator_staff_id` BIGINT NULL,
  `remark` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `order_status_logs_order_id_created_at_idx`(`order_id`, `created_at`),
  INDEX `order_status_logs_operator_user_id_idx`(`operator_user_id`),
  INDEX `order_status_logs_operator_staff_id_idx`(`operator_staff_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_staff`
  ADD CONSTRAINT `merchant_staff_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `categories`
  ADD CONSTRAINT `categories_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `products`
  ADD CONSTRAINT `products_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `products_category_id_fkey`
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `dining_tables`
  ADD CONSTRAINT `dining_tables_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `carts`
  ADD CONSTRAINT `carts_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `carts_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `carts_table_id_fkey`
  FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `cart_items`
  ADD CONSTRAINT `cart_items_cart_id_fkey`
  FOREIGN KEY (`cart_id`) REFERENCES `carts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `cart_items_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `orders`
  ADD CONSTRAINT `orders_user_id_fkey`
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `orders_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `orders_table_id_fkey`
  FOREIGN KEY (`table_id`) REFERENCES `dining_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `order_items`
  ADD CONSTRAINT `order_items_order_id_fkey`
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `order_items_product_id_fkey`
  FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `order_status_logs`
  ADD CONSTRAINT `order_status_logs_order_id_fkey`
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `order_status_logs_operator_user_id_fkey`
  FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `order_status_logs_operator_staff_id_fkey`
  FOREIGN KEY (`operator_staff_id`) REFERENCES `merchant_staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
