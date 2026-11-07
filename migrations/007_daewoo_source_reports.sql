-- Raw source records remain distinct from CPR settlement and bank receipts.
CREATE TABLE daewoo_source_reports (
  id BIGSERIAL PRIMARY KEY,
  realm_id TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES courier_accounts(id),
  customer_id TEXT NOT NULL,
  report_kind TEXT NOT NULL CHECK (report_kind IN ('cod-cpr','cod-cpr-detail','delivery-charge','tax','payment-report')),
  source_ref TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  payload JSONB NOT NULL,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (realm_id,account_id,customer_id,report_kind,source_ref)
);
CREATE INDEX daewoo_source_reports_range
  ON daewoo_source_reports(realm_id,account_id,report_kind,period_start,period_end);
ALTER TABLE daewoo_source_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE daewoo_source_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY daewoo_source_reports_company ON daewoo_source_reports
  USING (realm_id=current_setting('app.realm_id',true))
  WITH CHECK (realm_id=current_setting('app.realm_id',true));
