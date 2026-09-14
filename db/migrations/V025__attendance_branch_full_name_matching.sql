-- 记录现场到场名单按“客户类型 + 分公司 + 经销商全称”关联的匹配依据。
ALTER TABLE activity_attendee
  DROP CHECK ck_attendee_match_method,
  ADD CONSTRAINT ck_attendee_match_method CHECK (match_method IS NULL OR match_method IN ('PHONE', 'FULL_NAME', 'FULL_NAME_BRANCH', 'SHORT_NAME', 'MANUAL'));
