-- AlterTable
ALTER TABLE `dining_reservations` ADD COLUMN `assigned_table_id` BIGINT NULL,
    ADD COLUMN `assigned_table_name` VARCHAR(64) NULL,
    ADD COLUMN `assigned_table_no` VARCHAR(32) NULL;

-- CreateIndex
CREATE INDEX `dining_reservations_assigned_table_id_status_scheduled_for_idx` ON `dining_reservations`(`assigned_table_id`, `status`, `scheduled_for`);

-- AddForeignKey
ALTER TABLE `dining_reservations` ADD CONSTRAINT `dining_reservations_assigned_table_id_fkey` FOREIGN KEY (`assigned_table_id`) REFERENCES `dining_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
