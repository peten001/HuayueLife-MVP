-- Release Candidate connector support is fail-safe by default:
-- every existing merchant keeps printing_enabled = false, existing terminals
-- remain unpaired, and no token or pairing credential is backfilled.

ALTER TABLE `merchants`
    ADD COLUMN `printing_enabled` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `print_jobs`
    MODIFY `source` ENUM('AUTOMATIC', 'MANUAL', 'MANUAL_REPRINT', 'TEST') NOT NULL,
    ADD COLUMN `receipt_snapshot_hash` VARCHAR(64) NULL;

ALTER TABLE `print_attempts`
    ADD COLUMN `content_hash` VARCHAR(64) NULL,
    ADD COLUMN `bytes_written` INTEGER NULL;

ALTER TABLE `merchant_terminals`
    ADD COLUMN `bound_printer_id` BIGINT NULL,
    ADD COLUMN `device_identifier` VARCHAR(128) NULL,
    ADD COLUMN `pairing_id` VARCHAR(36) NULL,
    ADD COLUMN `pairing_code_hash` VARCHAR(64) NULL,
    ADD COLUMN `pairing_expires_at` DATETIME(3) NULL,
    ADD COLUMN `pairing_attempt_count` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `pairing_max_attempts` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `token_hash` VARCHAR(64) NULL,
    ADD COLUMN `token_version` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `token_issued_at` DATETIME(3) NULL,
    ADD COLUMN `token_expires_at` DATETIME(3) NULL,
    ADD COLUMN `paired_at` DATETIME(3) NULL,
    ADD COLUMN `config_version` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `reset_usb_requested_at` DATETIME(3) NULL,
    ADD COLUMN `reset_usb_acknowledged_at` DATETIME(3) NULL,
    ADD COLUMN `last_error_code` VARCHAR(64) NULL,
    ADD COLUMN `last_error_message` VARCHAR(500) NULL;

CREATE UNIQUE INDEX `uq_mt_device_identifier`
    ON `merchant_terminals`(`device_identifier`);
CREATE UNIQUE INDEX `uq_mt_pairing_id`
    ON `merchant_terminals`(`pairing_id`);
CREATE UNIQUE INDEX `uq_mt_token_hash`
    ON `merchant_terminals`(`token_hash`);
CREATE UNIQUE INDEX `uq_mt_bound_printer`
    ON `merchant_terminals`(`bound_printer_id`);
CREATE INDEX `ix_mt_merchant_printer`
    ON `merchant_terminals`(`merchant_id`, `bound_printer_id`);
CREATE INDEX `ix_mt_pairing_expiry`
    ON `merchant_terminals`(`pairing_expires_at`);
CREATE INDEX `ix_mt_token_expiry`
    ON `merchant_terminals`(`token_expires_at`);

ALTER TABLE `merchant_terminals`
    ADD CONSTRAINT `fk_mt_bound_printer`
    FOREIGN KEY (`bound_printer_id`) REFERENCES `printers`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Durable automatic-print trigger outbox. Rows are inserted in the same
-- transaction as order status logs, while all printing/terminal switches stay
-- disabled by default until the merchant explicitly enables them.
CREATE TABLE `print_trigger_outbox` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `order_id` BIGINT NOT NULL,
    `order_status_log_id` BIGINT NOT NULL,
    `print_rule_id` BIGINT NOT NULL,
    `printer_id` BIGINT NOT NULL,
    `receipt_template_id` BIGINT NULL,
    `event_key` VARCHAR(191) NOT NULL,
    `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'MANUAL') NOT NULL,
    `rule_version` VARCHAR(64) NOT NULL,
    `receipt_type` ENUM('ORDER_CUSTOMER', 'TABLE_BILL') NOT NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `priority` INTEGER NOT NULL DEFAULT 100,
    `status` ENUM('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `claimed_at` DATETIME(3) NULL,
    `lease_expires_at` DATETIME(3) NULL,
    `lease_version` INTEGER NOT NULL DEFAULT 0,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 20,
    `processed_at` DATETIME(3) NULL,
    `last_error_code` VARCHAR(64) NULL,
    `last_error_message` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_pto_event_key`(`event_key`),
    INDEX `ix_pto_merchant_claim`(`merchant_id`, `status`, `available_at`),
    INDEX `ix_pto_lease`(`status`, `lease_expires_at`),
    INDEX `ix_pto_order`(`order_id`, `created_at`),
    INDEX `ix_pto_status_log`(`order_status_log_id`),
    INDEX `ix_pto_rule`(`print_rule_id`, `created_at`),
    INDEX `ix_pto_printer`(`printer_id`),
    INDEX `ix_pto_template`(`receipt_template_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `print_trigger_outbox`
    ADD CONSTRAINT `fk_pto_merchant`
    FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pto_order`
    FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pto_status_log`
    FOREIGN KEY (`order_status_log_id`) REFERENCES `order_status_logs`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pto_rule`
    FOREIGN KEY (`print_rule_id`) REFERENCES `print_rules`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pto_printer`
    FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `fk_pto_template`
    FOREIGN KEY (`receipt_template_id`) REFERENCES `receipt_templates`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
