ALTER TABLE stored_file
  DROP CHECK ck_stored_file_purpose,
  ADD CONSTRAINT ck_stored_file_purpose
    CHECK (file_purpose IN ('IMPORT_SOURCE', 'PRODUCT_IMAGE', 'IMAGE_ARCHIVE', 'LOTTERY_PRIZE_IMAGE', 'EXPORT_RESULT', 'OTHER'));

ALTER TABLE lottery_round
  ADD COLUMN prize_image_file_id BIGINT UNSIGNED NULL AFTER prize_name,
  ADD KEY idx_lottery_round_prize_image (prize_image_file_id),
  ADD CONSTRAINT fk_lottery_round_prize_image
    FOREIGN KEY (prize_image_file_id) REFERENCES stored_file (id);
