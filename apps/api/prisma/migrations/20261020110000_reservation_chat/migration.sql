-- Retain existing order conversations and messages. A dining reservation has its
-- own conversation before seating, without creating an order or kitchen tasks.
ALTER TABLE `order_chat_conversations`
  DROP FOREIGN KEY `order_chat_conversations_order_id_fkey`;
ALTER TABLE `order_chat_conversations`
  MODIFY `order_id` BIGINT NULL,
  ADD COLUMN `reservation_id` BIGINT NULL,
  ADD UNIQUE INDEX `order_chat_conversations_reservation_id_key` (`reservation_id`),
  ADD CONSTRAINT `order_chat_conversations_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `order_chat_conversations_reservation_id_fkey`
    FOREIGN KEY (`reservation_id`) REFERENCES `dining_reservations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `order_chat_messages`
  DROP FOREIGN KEY `order_chat_messages_order_id_fkey`;
ALTER TABLE `order_chat_messages`
  MODIFY `order_id` BIGINT NULL,
  ADD CONSTRAINT `order_chat_messages_order_id_fkey`
    FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
