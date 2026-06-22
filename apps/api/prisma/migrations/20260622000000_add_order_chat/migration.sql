CREATE TABLE `order_chat_conversations` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `order_id` BIGINT NOT NULL,
  `merchant_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  `customer_unread_count` INT NOT NULL DEFAULT 0,
  `merchant_unread_count` INT NOT NULL DEFAULT 0,
  `last_message_id` BIGINT NULL,
  `last_message_at` DATETIME(3) NULL,
  `customer_last_read_at` DATETIME(3) NULL,
  `merchant_last_read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `order_chat_conversations_order_id_key`(`order_id`),
  UNIQUE INDEX `order_chat_conversations_last_message_id_key`(`last_message_id`),
  INDEX `order_chat_conversations_merchant_id_updated_at_idx`(`merchant_id`, `updated_at`),
  INDEX `order_chat_conversations_customer_id_updated_at_idx`(`customer_id`, `updated_at`),
  INDEX `order_chat_conversations_merchant_id_merchant_unread_count_idx`(`merchant_id`, `merchant_unread_count`),
  INDEX `order_chat_conversations_customer_id_customer_unread_count_idx`(`customer_id`, `customer_unread_count`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `order_chat_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT NOT NULL,
  `order_id` BIGINT NOT NULL,
  `sender_type` ENUM('CUSTOMER', 'MERCHANT', 'SYSTEM') NOT NULL,
  `sender_id` BIGINT NOT NULL,
  `content` TEXT NOT NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `order_chat_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
  INDEX `order_chat_messages_order_id_created_at_idx`(`order_id`, `created_at`),
  INDEX `order_chat_messages_conversation_id_id_idx`(`conversation_id`, `id`),
  INDEX `order_chat_messages_sender_type_sender_id_created_at_idx`(`sender_type`, `sender_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `order_chat_conversations`
  ADD CONSTRAINT `order_chat_conversations_order_id_fkey`
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `order_chat_conversations_merchant_id_fkey`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `order_chat_conversations_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `order_chat_messages`
  ADD CONSTRAINT `order_chat_messages_conversation_id_fkey`
  FOREIGN KEY (`conversation_id`) REFERENCES `order_chat_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `order_chat_messages_order_id_fkey`
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `order_chat_conversations`
  ADD CONSTRAINT `order_chat_conversations_last_message_id_fkey`
  FOREIGN KEY (`last_message_id`) REFERENCES `order_chat_messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
