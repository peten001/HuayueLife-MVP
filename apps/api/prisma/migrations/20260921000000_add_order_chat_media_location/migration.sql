ALTER TABLE `order_chat_messages`
  ADD COLUMN `message_type` ENUM('TEXT', 'IMAGE', 'LOCATION') NOT NULL DEFAULT 'TEXT',
  ADD COLUMN `media_url` VARCHAR(500) NULL,
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL;
