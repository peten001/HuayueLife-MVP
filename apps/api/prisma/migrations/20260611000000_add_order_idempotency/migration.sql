ALTER TABLE `orders`
  ADD COLUMN `idempotency_key` VARCHAR(64) NULL AFTER `order_no`;

UPDATE `orders`
SET `idempotency_key` = CONCAT('legacy-', `id`)
WHERE `idempotency_key` IS NULL;

ALTER TABLE `orders`
  MODIFY `idempotency_key` VARCHAR(64) NOT NULL,
  ADD UNIQUE INDEX `orders_user_id_idempotency_key_key`(`user_id`, `idempotency_key`);
