-- Per-row triggers rewrote order_dashboard_stat once for every order line. The summary reader stays off on the
-- H5 submit path. When it is enabled, DashboardSummaryStore.refresh marks the order dirty once at the end of the
-- business transaction and rebuilds. Raw SQL that changes order_item no longer marks the order dirty; use
-- DashboardSummaryCommand (check / rebuild / repair).

DROP TRIGGER IF EXISTS dashboard_item_insert;
DROP TRIGGER IF EXISTS dashboard_item_delete;
DROP TRIGGER IF EXISTS dashboard_item_update;
