ALTER TABLE activity_product
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;

ALTER TABLE order_item
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;

ALTER TABLE order_version_item
  MODIFY COLUMN rebate_status VARCHAR(20) NOT NULL;
