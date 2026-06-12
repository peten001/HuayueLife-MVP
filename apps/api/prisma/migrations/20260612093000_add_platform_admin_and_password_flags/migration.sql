UPDATE `merchants`
SET `status` = 'PENDING'
WHERE `status` = 'DRAFT';

UPDATE `merchants`
SET `status` = 'DISABLED'
WHERE `status` = 'CLOSED';

ALTER TABLE `merchants`
  MODIFY COLUMN `status` ENUM('PENDING', 'ACTIVE', 'DISABLED', 'DELETED') NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE `merchant_staff`
  ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT false AFTER `password_hash`;

UPDATE `merchant_staff`
SET `must_change_password` = false;
