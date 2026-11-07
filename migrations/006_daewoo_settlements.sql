CREATE TABLE daewoo_settlements (
 id BIGSERIAL PRIMARY KEY,
 realm_id TEXT NOT NULL,
 account_id INTEGER NOT NULL REFERENCES courier_accounts(id),
 customer_id TEXT NOT NULL,
 payment_ref TEXT NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('locked','received','reversed')),
 snapshot JSONB NOT NULL,
 bank_receipt JSONB,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(realm_id,account_id,payment_ref)
);
CREATE INDEX daewoo_settlement_account ON daewoo_settlements(realm_id,account_id,id);
ALTER TABLE daewoo_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE daewoo_settlements FORCE ROW LEVEL SECURITY;
CREATE POLICY daewoo_settlement_company ON daewoo_settlements
 USING(realm_id=current_setting('app.realm_id',true))
 WITH CHECK(realm_id=current_setting('app.realm_id',true));
CREATE TABLE daewoo_settlement_audit (
 id BIGSERIAL PRIMARY KEY,
 realm_id TEXT NOT NULL,
 settlement_id BIGINT NOT NULL REFERENCES daewoo_settlements(id),
 actor TEXT NOT NULL,
 action TEXT NOT NULL CHECK (action IN ('lock','bank-receipt','reverse')),
 old_value JSONB,
 new_value JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE daewoo_settlement_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE daewoo_settlement_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY daewoo_settlement_audit_company ON daewoo_settlement_audit
 USING(realm_id=current_setting('app.realm_id',true))
 WITH CHECK(realm_id=current_setting('app.realm_id',true));
