-- 商品导入统一为单 Sheet：客户类型、返利类型可为空，商品名称负责判重，产品说明进入商品目录。
ALTER TABLE activity_product
  ADD COLUMN description TEXT NULL AFTER material_name,
  DROP CHECK ck_product_customer_type,
  DROP CHECK ck_product_rebate,
  ADD CONSTRAINT ck_product_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL')),
  ADD CONSTRAINT ck_product_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE order_item
  DROP CHECK ck_order_item_rebate,
  ADD CONSTRAINT ck_order_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE order_version_item
  DROP CHECK ck_version_item_rebate,
  ADD CONSTRAINT ck_version_item_rebate CHECK (rebate_status IN ('PARTICIPATING', 'NOT_PARTICIPATING', 'ALL'));

ALTER TABLE product_image_review_candidate
  ADD COLUMN normalized_material_name VARCHAR(512) NULL AFTER material_name;

UPDATE product_image_review_candidate
SET normalized_material_name = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(material_name), ' ', ''), '　', ''), '-', ''), '_', ''))
WHERE normalized_material_name IS NULL OR normalized_material_name = '';

ALTER TABLE product_image_review_candidate
  MODIFY COLUMN normalized_material_name VARCHAR(512) NOT NULL,
  DROP INDEX uk_image_review_version_file_code,
  DROP INDEX idx_image_review_activity_version_status,
  ADD UNIQUE KEY uk_image_review_version_file_name (data_version_id, stored_file_id, normalized_material_name),
  ADD KEY idx_image_review_activity_version_status (activity_id, data_version_id, status, normalized_material_name);
