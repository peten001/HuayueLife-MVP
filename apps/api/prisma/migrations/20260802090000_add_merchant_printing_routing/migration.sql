CREATE TABLE `merchant_printing_routing` (
    `merchant_id` BIGINT NOT NULL,
    `checkout_default_printer_id` BIGINT NULL,
    `default_kitchen_printer_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`merchant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `printer_category_bindings` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `merchant_id` BIGINT NOT NULL,
    `printer_id` BIGINT NOT NULL,
    `category_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`),
    UNIQUE INDEX `uq_printer_category_binding_merchant_category`(`merchant_id`, `category_id`),
    UNIQUE INDEX `uq_printer_category_binding_printer_category`(`printer_id`, `category_id`),
    INDEX `ix_printer_category_binding_merchant_printer`(`merchant_id`, `printer_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `merchant_printing_routing`
  ADD CONSTRAINT `fk_merchant_printing_routing_merchant`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `printer_category_bindings`
  ADD CONSTRAINT `fk_printer_category_binding_merchant`
  FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_printer_category_binding_printer`
  FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_printer_category_binding_category`
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
