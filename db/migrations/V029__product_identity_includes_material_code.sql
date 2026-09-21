ALTER TABLE import_staging_row
  MODIFY COLUMN row_key VARCHAR(512) NULL;

ALTER TABLE activity_product
  MODIFY COLUMN business_key VARCHAR(512) NOT NULL;
