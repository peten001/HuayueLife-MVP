ALTER TABLE `print_jobs`
  ADD COLUMN `canonical_template_version` VARCHAR(64) NULL,
  ADD COLUMN `render_protocol` VARCHAR(64) NULL,
  ADD COLUMN `rendered_payload` LONGBLOB NULL,
  ADD COLUMN `rendered_payload_sha256` VARCHAR(64) NULL,
  ADD COLUMN `rendered_payload_byte_length` INTEGER NULL,
  ADD COLUMN `rendered_paper_width_mm` INTEGER NULL,
  ADD COLUMN `rendered_width_dots` INTEGER NULL;

ALTER TABLE `print_attempts`
  ADD COLUMN `expected_payload_sha256` VARCHAR(64) NULL,
  ADD COLUMN `actual_payload_sha256` VARCHAR(64) NULL,
  ADD COLUMN `transport` VARCHAR(80) NULL;
