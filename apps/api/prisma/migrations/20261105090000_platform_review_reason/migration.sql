-- Additive only. Existing moderation history remains readable.
ALTER TABLE `merchant_review_moderation_actions`
  ADD COLUMN `reason_code` VARCHAR(32) NULL,
  ADD COLUMN `reason_note` VARCHAR(255) NULL;
