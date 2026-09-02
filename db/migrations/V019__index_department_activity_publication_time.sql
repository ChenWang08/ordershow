-- 同部门发布时间冲突查询按部门、状态、发布时间和完整活动时间快速定位。
ALTER TABLE activity
  ADD KEY idx_activity_department_publication_time
    (department_id, status, published_at, starts_at, event_ends_at, ends_at);
