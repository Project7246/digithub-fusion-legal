-- Run once through initCprAudit. Do not edit after deployment.
CREATE TABLE courier_cpr_audit (
  id BIGSERIAL PRIMARY KEY,
  realm_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  cpr_number TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX courier_cpr_audit_read ON courier_cpr_audit (realm_id, account_id, cpr_number, created_at);
ALTER TABLE courier_cpr_audit ENABLE ROW LEVEL SECURITY;
-- The table owner retains the existing owner-only company graduation/bin
-- maintenance path. Non-owner access is restricted to the transaction realm.
CREATE POLICY courier_cpr_audit_company ON courier_cpr_audit
  USING (realm_id = current_setting('app.realm_id', true))
  WITH CHECK (realm_id = current_setting('app.realm_id', true));
