ALTER TABLE `order_items`
  ADD COLUMN `returned_quantity` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `kds_tasks`
  ADD COLUMN `returned_made_quantity` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `returned_served_quantity` INTEGER NOT NULL DEFAULT 0;
