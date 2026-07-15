-- Printing task center V1 is additive. Legacy printer_settings and print_logs
-- remain unchanged and no existing data is backfilled by this migration.

-- CreateTable
CREATE TABLE `printers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `channel_type` ENUM('LOCAL_LAN_ESCPOS', 'LOCAL_USB_ESCPOS', 'CLOUD_FEIE', 'CLOUD_XINYE', 'CLOUD_GPRINTER', 'BUILTIN_SUNMI', 'BUILTIN_IMIN') NOT NULL,
    `paper_width` ENUM('MM58', 'MM80') NOT NULL DEFAULT 'MM80',
    `purpose` ENUM('FRONT_DESK', 'KITCHEN', 'BAR', 'LABEL') NOT NULL DEFAULT 'FRONT_DESK',
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('UNVERIFIED', 'UNKNOWN', 'ONLINE', 'OFFLINE', 'ERROR') NOT NULL DEFAULT 'UNVERIFIED',
    `connection_config` JSON NOT NULL,
    `capabilities` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `ix_printer_merchant_enabled`(`merchant_id`, `enabled`),
    INDEX `ix_printer_merchant_channel`(`merchant_id`, `channel_type`),
    INDEX `ix_printer_merchant_deleted`(`merchant_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipt_templates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NULL,
    `name` VARCHAR(80) NOT NULL,
    `receipt_type` ENUM('ORDER_CUSTOMER', 'TABLE_BILL') NOT NULL,
    `paper_width` ENUM('MM58', 'MM80') NOT NULL,
    `language_mode` ENUM('MERCHANT_DEFAULT', 'ZH', 'VI', 'EN') NOT NULL DEFAULT 'MERCHANT_DEFAULT',
    `version` INTEGER NOT NULL DEFAULT 1,
    `definition` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_rt_merchant_type_enabled`(`merchant_id`, `receipt_type`, `enabled`),
    UNIQUE INDEX `uq_receipt_template_version`(`merchant_id`, `name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `print_rules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `order_type` ENUM('DINE_IN', 'PICKUP', 'DELIVERY') NULL,
    `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'MANUAL') NOT NULL,
    `receipt_type` ENUM('ORDER_CUSTOMER', 'TABLE_BILL') NOT NULL,
    `printer_id` BIGINT NOT NULL,
    `receipt_template_id` BIGINT NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `auto_print` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_pr_merchant_enabled_event`(`merchant_id`, `enabled`, `trigger_event`),
    INDEX `ix_pr_printer_enabled`(`printer_id`, `enabled`),
    INDEX `ix_pr_template`(`receipt_template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `print_jobs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `order_id` BIGINT NULL,
    `table_session_id` BIGINT NULL,
    `printer_id` BIGINT NOT NULL,
    `print_rule_id` BIGINT NULL,
    `rule_version` VARCHAR(64) NULL,
    `request_group_id` VARCHAR(64) NULL,
    `copy_index` INTEGER NOT NULL DEFAULT 1,
    `copy_count` INTEGER NOT NULL DEFAULT 1,
    `receipt_template_id` BIGINT NULL,
    `receipt_template_version` INTEGER NULL,
    `receipt_type` ENUM('ORDER_CUSTOMER', 'TABLE_BILL') NOT NULL,
    `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'MANUAL') NOT NULL,
    `source` ENUM('AUTOMATIC', 'MANUAL_REPRINT', 'TEST') NOT NULL,
    `status` ENUM('PENDING', 'CLAIMED', 'PRINTING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `priority` INTEGER NOT NULL DEFAULT 100,
    `dedupe_key` VARCHAR(191) NULL,
    `receipt_snapshot` JSON NOT NULL,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimed_at` DATETIME(3) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `lease_version` INTEGER NOT NULL DEFAULT 0,
    `claimed_by_terminal_id` BIGINT NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 3,
    `retry_blocked` BOOLEAN NOT NULL DEFAULT false,
    `completed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_by_staff_id` BIGINT NULL,
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_print_jobs_dedupe`(`dedupe_key`),
    INDEX `ix_pj_claim`(`merchant_id`, `status`, `available_at`, `priority`),
    INDEX `ix_pj_order`(`order_id`, `created_at`),
    INDEX `ix_pj_table_session`(`table_session_id`, `created_at`),
    INDEX `ix_pj_printer`(`printer_id`, `created_at`),
    INDEX `ix_pj_rule`(`print_rule_id`, `created_at`),
    INDEX `ix_pj_request_group`(`request_group_id`, `copy_index`),
    INDEX `ix_pj_terminal_status`(`claimed_by_terminal_id`, `status`),
    INDEX `ix_pj_lease`(`status`, `lease_expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `print_attempts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job_id` BIGINT NOT NULL,
    `attempt_no` INTEGER NOT NULL,
    `executor_type` ENUM('TERMINAL', 'SERVER_ADAPTER') NOT NULL,
    `terminal_id` BIGINT NULL,
    `adapter` VARCHAR(80) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `result` ENUM('SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN') NULL,
    `error_code` VARCHAR(64) NULL,
    `error_message` VARCHAR(500) NULL,
    `printer_response` VARCHAR(500) NULL,
    `app_version` VARCHAR(64) NULL,
    `network_info` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_pa_terminal_started`(`terminal_id`, `started_at`),
    INDEX `ix_pa_result_started`(`result`, `started_at`),
    UNIQUE INDEX `uq_pa_job_attempt`(`job_id`, `attempt_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `merchant_terminals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `platform` ENUM('ANDROID', 'WEB', 'SERVER') NOT NULL DEFAULT 'ANDROID',
    `status` ENUM('UNPAIRED', 'ACTIVE', 'DISABLED', 'REVOKED') NOT NULL DEFAULT 'UNPAIRED',
    `capabilities` JSON NOT NULL,
    `app_version` VARCHAR(64) NULL,
    `last_seen_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ix_mt_merchant_status`(`merchant_id`, `status`),
    INDEX `ix_mt_merchant_seen`(`merchant_id`, `last_seen_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `printing_audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `actor_staff_id` BIGINT NULL,
    `action` VARCHAR(64) NOT NULL,
    `resource_type` VARCHAR(64) NOT NULL,
    `resource_id` BIGINT NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `reason` VARCHAR(255) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ix_pal_merchant_created`(`merchant_id`, `created_at`),
    INDEX `ix_pal_resource_created`(`resource_type`, `resource_id`, `created_at`),
    INDEX `ix_pal_merchant_request`(`merchant_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `printers` ADD CONSTRAINT `printers_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_templates` ADD CONSTRAINT `receipt_templates_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_rules` ADD CONSTRAINT `print_rules_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_rules` ADD CONSTRAINT `print_rules_printer_id_fkey` FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_rules` ADD CONSTRAINT `print_rules_receipt_template_id_fkey` FOREIGN KEY (`receipt_template_id`) REFERENCES `receipt_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_table_session_id_fkey` FOREIGN KEY (`table_session_id`) REFERENCES `table_sessions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_printer_id_fkey` FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_print_rule_id_fkey` FOREIGN KEY (`print_rule_id`) REFERENCES `print_rules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_receipt_template_id_fkey` FOREIGN KEY (`receipt_template_id`) REFERENCES `receipt_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_claimed_by_terminal_id_fkey` FOREIGN KEY (`claimed_by_terminal_id`) REFERENCES `merchant_terminals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_jobs` ADD CONSTRAINT `print_jobs_created_by_staff_id_fkey` FOREIGN KEY (`created_by_staff_id`) REFERENCES `merchant_staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_attempts` ADD CONSTRAINT `print_attempts_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `print_jobs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `print_attempts` ADD CONSTRAINT `print_attempts_terminal_id_fkey` FOREIGN KEY (`terminal_id`) REFERENCES `merchant_terminals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `merchant_terminals` ADD CONSTRAINT `merchant_terminals_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `printing_audit_logs` ADD CONSTRAINT `printing_audit_logs_merchant_id_fkey` FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `printing_audit_logs` ADD CONSTRAINT `printing_audit_logs_actor_staff_id_fkey` FOREIGN KEY (`actor_staff_id`) REFERENCES `merchant_staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
