ALTER TABLE import_task
  ADD COLUMN image_decisions_json JSON NULL AFTER auxiliary_file_id;
