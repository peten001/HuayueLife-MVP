-- Merchant-originated add-on orders must not be assigned to an arbitrary miniapp user.
-- Existing customer orders retain user_id; merchant-created orders use created_by_staff_id.
ALTER TABLE `orders`
  MODIFY `user_id` BIGINT NULL,
  ADD COLUMN `created_by_staff_id` BIGINT NULL;

CREATE UNIQUE INDEX `uq_orders_staff_idempotency`
  ON `orders`(`merchant_id`, `created_by_staff_id`, `idempotency_key`);

CREATE INDEX `ix_orders_staff_created`
  ON `orders`(`created_by_staff_id`, `created_at`);

ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_created_by_staff`
    FOREIGN KEY (`created_by_staff_id`) REFERENCES `merchant_staff`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- MySQL does not allow this creator XOR as a CHECK while both columns
-- participate in foreign keys with referential actions. The API transaction
-- must enforce exactly one of user_id or created_by_staff_id for every order.

-- Extend the existing order_status_logs table instead of introducing a second log model.
-- Existing status rows remain valid because every new field is nullable.
ALTER TABLE `order_status_logs`
  ADD COLUMN `action` VARCHAR(64) NULL,
  ADD COLUMN `metadata` JSON NULL,
  ADD COLUMN `request_key` VARCHAR(64) NULL;

CREATE UNIQUE INDEX `uq_order_status_logs_request`
  ON `order_status_logs`(`order_id`, `request_key`);

CREATE INDEX `ix_order_status_logs_action`
  ON `order_status_logs`(`action`, `created_at`);
