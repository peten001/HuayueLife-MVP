CREATE TABLE `merchant_reviews` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `merchant_id` BIGINT NOT NULL,
  `rating` INTEGER NOT NULL,
  `content` VARCHAR(1000) NULL,
  `is_anonymous` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `merchant_reviews_order_id_key`(`order_id`),
  INDEX `merchant_reviews_merchant_id_status_created_at_idx`(`merchant_id`, `status`, `created_at`),
  INDEX `merchant_reviews_user_id_created_at_idx`(`user_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `merchant_review_images` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT NOT NULL,
  `image_url` VARCHAR(500) NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `merchant_review_images_review_id_sort_order_idx`(`review_id`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_reviews`
  ADD CONSTRAINT `merchant_reviews_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `merchant_reviews_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `merchant_reviews_merchant_id_fkey`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `merchant_review_images`
  ADD CONSTRAINT `merchant_review_images_review_id_fkey`
    FOREIGN KEY (`review_id`) REFERENCES `merchant_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
