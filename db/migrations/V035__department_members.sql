-- One administrator per department, multiple individual members.
ALTER TABLE admin_user
  DROP CHECK ck_admin_user_department_role,
  DROP CHECK ck_admin_user_role,
  ADD KEY idx_admin_user_department (department_id),
  DROP INDEX uk_admin_user_department,
  ADD COLUMN department_admin_scope BIGINT UNSIGNED GENERATED ALWAYS AS
    (CASE WHEN role_code = 'DEPARTMENT_ADMIN' THEN department_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_department_admin_scope (department_admin_scope),
  ADD CONSTRAINT ck_admin_user_role CHECK (role_code IN ('SUPER_ADMIN','DEPARTMENT_ADMIN','DEPARTMENT_MEMBER')),
  ADD CONSTRAINT ck_admin_user_department_role CHECK
    ((role_code = 'SUPER_ADMIN' AND department_id IS NULL) OR
     (role_code IN ('DEPARTMENT_ADMIN','DEPARTMENT_MEMBER') AND department_id IS NOT NULL));

CREATE TABLE admin_user_permission (
  admin_user_id BIGINT UNSIGNED NOT NULL,
  permission_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (admin_user_id, permission_code),
  CONSTRAINT fk_member_permission_user FOREIGN KEY (admin_user_id) REFERENCES admin_user(id),
  CONSTRAINT ck_member_permission CHECK (permission_code IN ('OVERVIEW','PRODUCT','WHITELIST','ATTENDANCE','ORDER','LOTTERY'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Do not invent historical identities; old rows retain their actual actor ID.
ALTER TABLE audit_log ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL,
  ADD COLUMN actor_role_snapshot VARCHAR(32) NULL;
ALTER TABLE order_operation ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL,
  ADD COLUMN actor_role_snapshot VARCHAR(32) NULL;
ALTER TABLE order_version ADD COLUMN actor_identity_snapshot VARCHAR(255) NULL;
ALTER TABLE order_change_request ADD COLUMN reviewer_identity_snapshot VARCHAR(255) NULL;
