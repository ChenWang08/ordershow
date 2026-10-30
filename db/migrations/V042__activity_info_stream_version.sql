-- Public activity synchronization is independent of admin optimistic locking and order events.
ALTER TABLE activity ADD COLUMN public_info_version BIGINT NOT NULL DEFAULT 1;
