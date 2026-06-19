ALTER TABLE `merchants`
  ADD COLUMN `homepage_category_keys` VARCHAR(255) NOT NULL DEFAULT '[]',
  ADD COLUMN `manual_popular` BOOLEAN NOT NULL DEFAULT false;
