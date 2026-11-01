import { readFileSync } from 'node:fs';
import { pool } from './db.js';

// One numbered migration, serialized across boots. The table's existence is
// its applied marker; this never alters or replaces an existing audit table.
export async function initCprAudit() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fusion:001_courier_cpr_audit'))");
    const found = await client.query("SELECT to_regclass('public.courier_cpr_audit') AS applied");
    if (!found.rows[0]?.applied) {
      await client.query(readFileSync(new URL('./migrations/001_courier_cpr_audit.sql', import.meta.url), 'utf8'));
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function recordCprChanges(client, realmId, accountId, changes) {
  if (!changes.length) return;
  await client.query(
    `INSERT INTO courier_cpr_audit (realm_id, account_id, cpr_number, actor, action, old_value, new_value)
     SELECT $1, $2, x.cpr, 'courier:mnp', 'consolidated-payment-sync', x.old_value, x.new_value
       FROM jsonb_to_recordset($3::jsonb) AS x(cpr TEXT, old_value JSONB, new_value JSONB)`,
    [realmId, Number(accountId), JSON.stringify(changes)]);
}
