-- 部门共享账号由超级管理员统一管理密码，不再要求部门首次登录改密。
-- 超级管理员继续使用 admin_user.must_change_password 的原有安全策略。
UPDATE admin_user u
JOIN department d ON d.id = u.department_id
SET u.display_name = d.department_name,
    u.must_change_password = FALSE,
    u.password_changed_at = COALESCE(u.password_changed_at, UTC_TIMESTAMP(3))
WHERE u.role_code = 'DEPARTMENT_ADMIN';
