ALTER TABLE import_task
  ADD COLUMN match_base_version_id BIGINT UNSIGNED NULL AFTER auxiliary_file_id,
  ADD KEY idx_import_task_match_base_version (match_base_version_id),
  ADD CONSTRAINT fk_import_task_match_base_version
    FOREIGN KEY (match_base_version_id) REFERENCES import_publish_version (id);
