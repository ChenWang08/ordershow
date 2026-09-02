-- 部门账号与活动归属：一个部门一个后台账号；活动按部门隔离。

CREATE TABLE department (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_code VARCHAR(64) NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  lock_version INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uk_department_code (department_code),
  CONSTRAINT ck_department_status CHECK (status IN ('ACTIVE', 'DISABLED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO department(department_code, department_name, status)
VALUES ('DEFAULT', '默认业务部门', 'ACTIVE');

ALTER TABLE admin_user
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER role_code,
  DROP CHECK ck_admin_user_role;

UPDATE admin_user
SET role_code = 'SUPER_ADMIN'
WHERE role_code = 'ADMIN';

ALTER TABLE admin_user
  ADD CONSTRAINT fk_admin_user_department FOREIGN KEY (department_id) REFERENCES department (id),
  ADD CONSTRAINT uk_admin_user_department UNIQUE (department_id),
  ADD CONSTRAINT ck_admin_user_role CHECK (role_code IN ('SUPER_ADMIN', 'DEPARTMENT_ADMIN'));

ALTER TABLE activity
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER id;

UPDATE activity a
JOIN department d ON d.department_code = 'DEFAULT'
SET a.department_id = d.id
WHERE a.department_id IS NULL;

ALTER TABLE activity
  MODIFY COLUMN department_id BIGINT UNSIGNED NOT NULL,
  ADD KEY idx_activity_department_status_time (department_id, status, starts_at, ends_at),
  ADD CONSTRAINT fk_activity_department FOREIGN KEY (department_id) REFERENCES department (id);
