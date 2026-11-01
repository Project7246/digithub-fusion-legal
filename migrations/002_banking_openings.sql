-- Additive Banking setup history. Existing balances and movements are untouched.
CREATE TABLE banking_setups (
  id BIGSERIAL PRIMARY KEY,
  realm_id TEXT NOT NULL,
  bank_id INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  opening_in NUMERIC(16,2) NOT NULL CHECK (opening_in >= 0),
  opening_out NUMERIC(16,2) NOT NULL CHECK (opening_out >= 0),
  in_from DATE NOT NULL,
  out_from DATE NOT NULL,
  actor TEXT NOT NULL,
  previous_id BIGINT REFERENCES banking_setups(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX banking_setups_read ON banking_setups (realm_id,bank_id,fiscal_year,id DESC);
ALTER TABLE banking_setups ENABLE ROW LEVEL SECURITY;
CREATE POLICY banking_setups_company ON banking_setups
  USING (realm_id = current_setting('app.realm_id',true))
  WITH CHECK (realm_id = current_setting('app.realm_id',true));
CREATE TABLE banking_entry_audit (
  id BIGSERIAL PRIMARY KEY,
  realm_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  new_value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX banking_entry_audit_realm ON banking_entry_audit (realm_id);
ALTER TABLE banking_entry_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY banking_entry_audit_company ON banking_entry_audit
  USING (realm_id = current_setting('app.realm_id',true))
  WITH CHECK (realm_id = current_setting('app.realm_id',true));
