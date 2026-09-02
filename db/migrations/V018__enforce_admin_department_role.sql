-- 管理员角色与部门归属保持一致：超级管理员不绑定部门，部门账号必须绑定部门。
ALTER TABLE admin_user
  ADD CONSTRAINT ck_admin_user_department_role CHECK (
    (role_code = 'SUPER_ADMIN' AND department_id IS NULL)
    OR (role_code = 'DEPARTMENT_ADMIN' AND department_id IS NOT NULL)
  );
