-- Cloud execution is additive and remains inside the existing PrintJob /
-- PrintAttempt state machine. Existing terminal attempts stay unchanged
-- because every new column is nullable or has a safe default.
ALTER TABLE `print_attempts`
  ADD COLUMN `cloud_status` ENUM(
    'PENDING',
    'CLAIMED',
    'SUBMITTING',
    'SUBMITTED',
    'ACCEPTED',
    'PRINTED',
    'FAILED',
    'UNKNOWN',
    'NOT_CONFIGURED',
    'CANCELLED'
  ) NULL AFTER `result`,
  ADD COLUMN `executor_id` VARCHAR(128) NULL AFTER `cloud_status`,
  ADD COLUMN `provider_request_id` VARCHAR(64) NULL AFTER `executor_id`,
  ADD COLUMN `provider_task_id` VARCHAR(191) NULL AFTER `provider_request_id`,
  ADD COLUMN `provider_submitted_at` DATETIME(3) NULL AFTER `provider_task_id`,
  ADD COLUMN `provider_checked_at` DATETIME(3) NULL AFTER `provider_submitted_at`,
  ADD COLUMN `provider_check_count` INTEGER NOT NULL DEFAULT 0 AFTER `provider_checked_at`;

CREATE UNIQUE INDEX `uq_pa_adapter_request`
  ON `print_attempts`(`adapter`, `provider_request_id`);

CREATE UNIQUE INDEX `uq_pa_adapter_task`
  ON `print_attempts`(`adapter`, `provider_task_id`);

CREATE INDEX `ix_pa_cloud_poll`
  ON `print_attempts`(`cloud_status`, `provider_checked_at`);
