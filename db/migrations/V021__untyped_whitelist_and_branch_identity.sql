-- 白名单统一为单 Sheet：空客户类型代表不区分客户类型（ALL），经销商身份按客户类型 + 全称 + 分公司判重。
ALTER TABLE customer
  ADD COLUMN branch_name VARCHAR(200) NOT NULL DEFAULT '' AFTER normalized_dealer_full_name,
  ADD COLUMN normalized_branch_name VARCHAR(200) NOT NULL DEFAULT '' AFTER branch_name,
  DROP INDEX uk_customer_type_full_name,
  DROP CHECK ck_customer_type,
  ADD UNIQUE KEY uk_customer_type_full_name_branch (customer_type, normalized_dealer_full_name, normalized_branch_name),
  ADD CONSTRAINT ck_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE activity_customer
  ADD COLUMN normalized_dealer_full_name VARCHAR(255) NOT NULL DEFAULT '' AFTER dealer_full_name,
  DROP CHECK ck_activity_customer_type,
  ADD CONSTRAINT ck_activity_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

UPDATE activity_customer
SET normalized_dealer_full_name = LOWER(REPLACE(REPLACE(TRIM(dealer_full_name), ' ', ''), '　', ''))
WHERE normalized_dealer_full_name = '';

UPDATE activity_customer
SET normalized_branch_name = LOWER(REPLACE(REPLACE(TRIM(COALESCE(branch_name, '')), ' ', ''), '　', ''))
WHERE normalized_branch_name IS NULL;

ALTER TABLE activity_customer
  ADD UNIQUE KEY uk_activity_customer_name_branch
    (activity_id, data_version_id, customer_type, normalized_dealer_full_name, normalized_branch_name);

ALTER TABLE customer_order
  DROP CHECK ck_order_customer_type,
  ADD CONSTRAINT ck_order_customer_type CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE order_version
  DROP CHECK ck_order_version_customer,
  ADD CONSTRAINT ck_order_version_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE order_version_item
  DROP CHECK ck_version_item_customer,
  ADD CONSTRAINT ck_version_item_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE visit_event
  DROP CHECK ck_visit_event_customer_type,
  ADD CONSTRAINT ck_visit_event_customer_type CHECK (customer_type IS NULL OR customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));

ALTER TABLE lottery_candidate_snapshot
  DROP CHECK ck_lottery_candidate_customer,
  ADD CONSTRAINT ck_lottery_candidate_customer CHECK (customer_type IN ('GENERAL', 'SPECIAL', 'ALL'));
