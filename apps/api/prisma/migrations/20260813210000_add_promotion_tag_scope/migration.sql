ALTER TABLE `promotion_tags`
  ADD COLUMN `scope` ENUM('OPERATIONAL', 'CUISINE', 'SCENE') NOT NULL DEFAULT 'OPERATIONAL' AFTER `description`;

CREATE INDEX `promotion_tags_scope_enabled_sort_order_idx`
  ON `promotion_tags`(`scope`, `enabled`, `sort_order`);
