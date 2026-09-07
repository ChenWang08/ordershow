ALTER TABLE activity_customer
  ADD COLUMN phone VARCHAR(32) NULL AFTER contact_name,
  ADD COLUMN confirmer_phone VARCHAR(32) NULL AFTER confirmer_name,
  MODIFY COLUMN phone_ciphertext VARBINARY(512) NULL;

ALTER TABLE activity_attendee
  ADD COLUMN phone VARCHAR(32) NULL AFTER branch_name_snapshot;
