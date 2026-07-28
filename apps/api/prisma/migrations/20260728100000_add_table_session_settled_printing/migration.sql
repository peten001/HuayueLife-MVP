-- Add the independent table-session settlement event without changing the
-- receipt document schema or any printer execution adapter.
ALTER TABLE `print_rules`
  MODIFY `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'TABLE_SESSION_SETTLED', 'MANUAL') NOT NULL;

ALTER TABLE `print_jobs`
  MODIFY `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'TABLE_SESSION_SETTLED', 'MANUAL') NOT NULL;

ALTER TABLE `print_trigger_outbox`
  MODIFY `order_id` BIGINT NULL,
  MODIFY `order_status_log_id` BIGINT NULL,
  ADD COLUMN `table_session_id` BIGINT NULL AFTER `order_status_log_id`,
  MODIFY `trigger_event` ENUM('ORDER_ACCEPTED', 'ORDER_COMPLETED', 'TABLE_SESSION_SETTLED', 'MANUAL') NOT NULL;

CREATE INDEX `ix_pto_table_session` ON `print_trigger_outbox`(`table_session_id`, `created_at`);

ALTER TABLE `print_trigger_outbox`
  ADD CONSTRAINT `fk_pto_table_session`
    FOREIGN KEY (`table_session_id`) REFERENCES `table_sessions`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
