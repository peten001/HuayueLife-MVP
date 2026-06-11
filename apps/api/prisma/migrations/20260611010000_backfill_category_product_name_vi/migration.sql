UPDATE `categories`
SET `name_vi` = `name_zh`
WHERE `name_vi` IS NULL OR `name_vi` = '';

UPDATE `products`
SET `name_vi` = `name_zh`
WHERE `name_vi` IS NULL OR `name_vi` = '';
