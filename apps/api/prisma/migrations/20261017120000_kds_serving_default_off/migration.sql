-- Only change the default for new settings; retain every merchant's explicit configuration.
ALTER TABLE `kds_settings` ALTER COLUMN `serving_enabled` SET DEFAULT false;
