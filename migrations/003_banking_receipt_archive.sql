-- Banking-owned retained records; no dependency on a courier login/account row.
ALTER TABLE banks ADD COLUMN opening_balance_on DATE;
CREATE TABLE banking_receipt_archive (
  realm_id TEXT NOT NULL,
  account_id INTEGER NOT NULL,
  cpr_number TEXT NOT NULL,
  courier TEXT NOT NULL,
  net_amount NUMERIC(16,2),
  paid_on DATE,
  cover JSONB NOT NULL,
  source_read_at TIMESTAMPTZ NOT NULL,
  detail BYTEA,
  detail_hash TEXT,
  detail_complete BOOLEAN NOT NULL DEFAULT FALSE,
  detail_orders INTEGER NOT NULL DEFAULT 0,
  detail_saved_at TIMESTAMPTZ,
  detail_next_try TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (realm_id,account_id,cpr_number)
);
CREATE INDEX banking_receipt_archive_paid ON banking_receipt_archive (realm_id,paid_on);
CREATE INDEX banking_receipt_archive_pending ON banking_receipt_archive (realm_id,detail_next_try)
  WHERE detail_complete IS FALSE;
ALTER TABLE banking_receipt_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY banking_receipt_archive_company ON banking_receipt_archive
  USING (realm_id=current_setting('app.realm_id',true))
  WITH CHECK (realm_id=current_setting('app.realm_id',true));
