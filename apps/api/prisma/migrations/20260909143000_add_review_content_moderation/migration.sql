ALTER TABLE `merchant_reviews`
  MODIFY `status` ENUM('PENDING_REVIEW', 'PUBLISHED', 'HIDDEN') NOT NULL DEFAULT 'PUBLISHED';

CREATE TABLE `merchant_review_moderation_checks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT NOT NULL,
  `image_id` BIGINT NULL,
  `type` ENUM('LOCAL_TEXT', 'WECHAT_TEXT', 'WECHAT_IMAGE') NOT NULL,
  `status` ENUM('PENDING', 'PASS', 'REVIEW', 'RISKY', 'ERROR') NOT NULL,
  `reason_codes` JSON NULL,
  `provider_label` INTEGER NULL,
  `provider_trace_id` VARCHAR(120) NULL,
  `error_code` VARCHAR(80) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `merchant_review_moderation_checks_provider_trace_id_key`(`provider_trace_id`),
  INDEX `merchant_review_moderation_checks_review_id_type_status_idx`(`review_id`, `type`, `status`),
  INDEX `merchant_review_moderation_checks_status_created_at_idx`(`status`, `created_at`),
  INDEX `merchant_review_moderation_checks_image_id_idx`(`image_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `merchant_review_moderation_actions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `review_id` BIGINT NOT NULL,
  `action` ENUM('PUBLISH', 'HIDE', 'RESTORE') NOT NULL,
  `from_status` ENUM('PENDING_REVIEW', 'PUBLISHED', 'HIDDEN') NOT NULL,
  `to_status` ENUM('PENDING_REVIEW', 'PUBLISHED', 'HIDDEN') NOT NULL,
  `actor_username` VARCHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `merchant_review_moderation_actions_review_id_created_at_idx`(`review_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_review_moderation_checks`
  ADD CONSTRAINT `merchant_review_moderation_checks_review_id_fkey`
    FOREIGN KEY (`review_id`) REFERENCES `merchant_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `merchant_review_moderation_checks_image_id_fkey`
    FOREIGN KEY (`image_id`) REFERENCES `merchant_review_images`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `merchant_review_moderation_actions`
  ADD CONSTRAINT `merchant_review_moderation_actions_review_id_fkey`
    FOREIGN KEY (`review_id`) REFERENCES `merchant_reviews`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
