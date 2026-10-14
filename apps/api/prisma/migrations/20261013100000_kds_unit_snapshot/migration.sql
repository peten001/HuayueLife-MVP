-- Preserve the menu selling unit for each kitchen task. Existing development
-- tasks default to portions; new tasks snapshot the current product unit.
ALTER TABLE `kds_tasks` ADD COLUMN `unit` VARCHAR(32) NOT NULL DEFAULT '份';
