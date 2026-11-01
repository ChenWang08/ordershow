-- Phone-first H5 verification, including the missing/null publication-binding compatibility path.
-- Keep the lookup prefix independent of data_version_id and customer_type.
ALTER TABLE activity_customer
  ADD KEY idx_ac_activity_phone (activity_id, phone_lookup_hash, is_active);
