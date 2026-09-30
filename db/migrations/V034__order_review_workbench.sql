UPDATE order_change_request SET status='REJECTED', review_reason=COALESCE(review_reason,'订单已发生变化，请重新提交') WHERE status='CONFLICTED';
ALTER TABLE order_change_request DROP CHECK ck_order_change_request_status,
  ADD COLUMN original_order_json JSON NULL,
  ADD CONSTRAINT ck_order_change_request_status CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  ADD COLUMN pending_order_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status='PENDING' THEN order_id ELSE NULL END) STORED,
  ADD UNIQUE KEY uk_order_change_pending (pending_order_id);
