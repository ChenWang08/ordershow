ALTER TABLE activity
    ADD COLUMN h5_background_file_id BIGINT UNSIGNED NULL,
    ADD COLUMN desktop_background_file_id BIGINT UNSIGNED NULL,
    ADD CONSTRAINT fk_activity_h5_background FOREIGN KEY (h5_background_file_id) REFERENCES stored_file(id),
    ADD CONSTRAINT fk_activity_desktop_background FOREIGN KEY (desktop_background_file_id) REFERENCES stored_file(id);

ALTER TABLE stored_file DROP CHECK ck_stored_file_purpose;
ALTER TABLE stored_file ADD CONSTRAINT ck_stored_file_purpose CHECK (
    file_purpose IN ('IMPORT_SOURCE', 'PRODUCT_IMAGE', 'IMAGE_ARCHIVE', 'EXPORT_RESULT', 'OTHER', 'LOTTERY_PRIZE_IMAGE', 'ACTIVITY_BACKGROUND')
);
