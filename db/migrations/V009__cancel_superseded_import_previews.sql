UPDATE import_task t
JOIN activity_data_binding b
  ON b.activity_id = t.activity_id
 AND b.data_type = t.import_type
JOIN import_publish_version v
  ON v.id = b.current_version_id
SET t.status = 'CANCELLED'
WHERE t.id < v.source_import_task_id
  AND t.status IN ('UPLOADED', 'PARSING', 'PREVIEW_READY');
