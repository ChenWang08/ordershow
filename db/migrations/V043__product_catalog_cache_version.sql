-- Shared H5 catalog snapshots have their own revision, including image and visibility changes.
ALTER TABLE activity ADD COLUMN product_catalog_version BIGINT NOT NULL DEFAULT 1;
