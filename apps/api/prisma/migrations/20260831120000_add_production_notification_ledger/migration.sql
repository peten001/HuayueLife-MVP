-- Existing open-order quantities were handled by the legacy immediate-print
-- flow before this cutover. Backfill them as already notified so deploying the
-- new manual notification button cannot replay historical dishes.
ALTER TABLE `order_items`
  ADD COLUMN `production_notified_quantity` INTEGER NOT NULL DEFAULT 0 AFTER `quantity`;

UPDATE `order_items` AS `oi`
INNER JOIN `orders` AS `o` ON `o`.`id` = `oi`.`order_id`
SET `oi`.`production_notified_quantity` = `oi`.`quantity`
WHERE `o`.`order_type` = 'DINE_IN'
  AND `o`.`status` IN ('PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'READY');

-- The durable trigger outbox now carries whether the intent came from an
-- automatic customer submission or an explicit cashier notification.
ALTER TABLE `print_trigger_outbox`
  ADD COLUMN `source` ENUM('AUTOMATIC', 'MANUAL', 'MANUAL_REPRINT', 'TEST') NOT NULL DEFAULT 'AUTOMATIC' AFTER `priority`,
  ADD COLUMN `created_by_staff_id` BIGINT NULL AFTER `source`;

-- A managed route remains configured when automatic dispatch is switched
-- off. Only auto_print controls customer-submission automation; enabled keeps
-- the same route available to the cashier's explicit Notify action.
UPDATE `print_rules`
SET `enabled` = true
WHERE `name` LIKE '__ROUTING_NEW_ORDER__:FRONT_DESK:%'
   OR `name` LIKE '__ROUTING_NEW_ORDER__:KITCHEN:%';
