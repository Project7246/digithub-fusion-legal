import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

// Neon charges for the time its compute is awake, not for the queries run, and it
// goes back to sleep only after nothing has touched it for a few minutes. A pool
// that holds a connection open is a thing touching it, so the connections are let
// go quickly and few are kept - the database sleeps between spells of work, which
// is where nearly all of the month's allowance was going.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 5000,
  allowExitOnIdle: false
});

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      id             SERIAL PRIMARY KEY,
      realm_id       TEXT UNIQUE NOT NULL,
      company_name   TEXT,
      refresh_token  TEXT NOT NULL,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // A company exists before QuickBooks does.
  //
  // It used to be the other way round: a row here was a set of books the app had
  // been connected to, so the key was Intuit's realm number and the refresh token
  // had to be there. But the app is not only the books. Somebody sells on Shopify,
  // books parcels with three couriers and keeps staff, and may never open
  // QuickBooks at all - and until this row existed there was nowhere for any of
  // that to sit, and nobody to hand out user ids. So a company is made when the
  // person signs up, with an id of our own (fx-...), and QuickBooks is something
  // it joins later - see graduateWorkspace().
  await pool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_sub TEXT`);
  await pool.query(
    `ALTER TABLE companies ALTER COLUMN refresh_token DROP NOT NULL`);
  // Deleting a company is not a thing to get wrong once. The row is marked here
  // instead and vanishes from every list, and the rows it owns are left exactly
  // where they are - so putting it back is one word, for BIN_DAYS days.
  await pool.query(
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  // The access token lives for an hour. Keeping it means a hundred jobs in a
  // minute are one sign-in and not a hundred, and a hundred refreshes in a
  // minute is exactly what invalidates a refresh token.
  await pool.query(
    `ALTER TABLE companies
       ADD COLUMN IF NOT EXISTS access_token   TEXT,
       ADD COLUMN IF NOT EXISTS access_expires TIMESTAMPTZ,
       ADD COLUMN IF NOT EXISTS qb_error       TEXT`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS upload_logs (
      id           SERIAL PRIMARY KEY,
      realm_id     TEXT NOT NULL,
      doc_number   TEXT,
      status       TEXT,
      message      TEXT,
      intuit_tid   TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS negative_items (
      realm_id    TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (realm_id, item_name)
    );
  `);

  console.log('Database ready');
}

export async function saveCompany(realmId, companyName, refreshToken) {
  await pool.query(
    `INSERT INTO companies (realm_id, company_name, refresh_token)
     VALUES ($1, $2, $3)
     ON CONFLICT (realm_id)
     DO UPDATE SET refresh_token = $3, company_name = $2, updated_at = NOW()`,
    [realmId, companyName, refreshToken]
  );
}

// A deleted company answers to nothing: no token, no pages, no runs. The bin
// reads it with getBinnedCompany() instead, which is the only thing that may.
export async function getCompany(realmId) {
  const r = await pool.query(
    'SELECT * FROM companies WHERE realm_id = $1 AND deleted_at IS NULL', [realmId]);
  return r.rows[0] || null;
}

export async function getBinnedCompany(realmId) {
  const r = await pool.query(
    'SELECT * FROM companies WHERE realm_id = $1 AND deleted_at IS NOT NULL', [realmId]);
  return r.rows[0] || null;
}

// The access token, kept beside the refresh token rather than fetched again by
// everybody who needs one. Intuit hands out a new refresh token every time one
// is used and kills the old one, so two refreshes racing each other is how a
// company gets signed out of its own books - see getAccessToken in qb.js.
export async function saveQbTokens(realmId, { access, expires, refresh }) {
  await pool.query(
    `UPDATE companies
        SET access_token  = $2,
            access_expires = $3,
            refresh_token = COALESCE($4, refresh_token),
            qb_error      = NULL,
            updated_at    = NOW()
      WHERE realm_id = $1`,
    [realmId, access || null, expires || null, refresh || null]
  );
}

// Intuit has stopped accepting our refresh token. Nothing here can mend that -
// somebody has to connect the books again - so it is written down, said in
// words, and not hammered at every minute by the background sweeps.
export async function markQbBroken(realmId, why) {
  await pool.query(
    `UPDATE companies SET qb_error = $2, access_token = NULL, access_expires = NULL,
            updated_at = NOW()
      WHERE realm_id = $1`,
    [realmId, String(why || '').slice(0, 300)]
  );
}

export async function updateRefreshToken(realmId, refreshToken) {
  await pool.query(
    'UPDATE companies SET refresh_token = $1, updated_at = NOW() WHERE realm_id = $2',
    [refreshToken, realmId]
  );
}

export async function logUpload(realmId, docNumber, status, message, tid) {
  await pool.query(
    `INSERT INTO upload_logs (realm_id, doc_number, status, message, intuit_tid)
     VALUES ($1, $2, $3, $4, $5)`,
    [realmId, docNumber, status, (message || '').slice(0, 1000), tid || null]
  );
}

export async function getNegativeItems(realmId) {
  const r = await pool.query(
    'SELECT item_name FROM negative_items WHERE realm_id = $1',
    [realmId]
  );
  return r.rows.map(x => x.item_name);
}

export async function setNegativeItems(realmId, items) {
  await pool.query('DELETE FROM negative_items WHERE realm_id = $1', [realmId]);
  if (!items || !items.length) return;
  const values = items.map((_, i) => `($1, $${i + 2})`).join(',');
  await pool.query(
    `INSERT INTO negative_items (realm_id, item_name) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [realmId, ...items]
  );
}

// Only the name, never the key. The key is rotated by QuickBooks as the app works
// and writing a remembered copy of it back would sign the company out.
export async function renameCompany(realmId, companyName) {
  await pool.query(
    'UPDATE companies SET company_name = $1 WHERE realm_id = $2',
    [companyName, realmId]
  );
}

// ==================== a company before QuickBooks ====================
// Which kind of id this is. Intuit's realm is all digits; ours never is, so the
// two can never be mistaken for one another, in a cookie or in a column.
export function isWorkspace(realmId) {
  return /^fx-[0-9a-f]{16}$/.test(String(realmId || ''));
}

// The company somebody makes by signing up. It has a name they typed, an owner,
// and no books - which is exactly what every courier, Shopify and HR screen
// needs, and what the owner needs to hand out user ids. Nothing about it is
// QuickBooks' to give.
export async function createWorkspace(name, ownerSub) {
  const id = 'fx-' + crypto.randomBytes(8).toString('hex');
  await pool.query(
    `INSERT INTO companies (realm_id, company_name, refresh_token, owner_sub)
     VALUES ($1, $2, NULL, $3)`,
    [id, String(name || '').trim() || null, ownerSub || null]);
  return id;
}

// The workspaces this person made and runs, newest last.
export async function workspacesOwnedBy(sub) {
  if (!sub) return [];
  const r = await pool.query(
    `SELECT realm_id, company_name FROM companies
      WHERE owner_sub = $1 AND refresh_token IS NULL AND deleted_at IS NULL
      ORDER BY created_at`, [sub]);
  return r.rows.filter(x => isWorkspace(x.realm_id))
    .map(x => ({ realmId: x.realm_id, name: x.company_name || '' }));
}

// The workspace joins QuickBooks, and keeps everything it had.
//
// The alternative was to leave the two apart - the workspace with the couriers
// in it and a second row for the books - and then one person would have two
// companies, each holding half of their work, and a chooser asking which half
// they wanted today. So the workspace takes the realm number as its own id
// instead: from here on it IS that company, every page asks QuickBooks the
// right thing, and the parcels booked before the books were connected are still
// sitting where they were.
//
// Which columns to carry over is read from the database rather than written out
// here, because a table added next month would otherwise be left behind holding
// an id nothing answers to - and nobody would notice until its rows went quiet.
export async function graduateWorkspace(fromId, toRealm) {
  if (!isWorkspace(fromId)) return { error: 'That is not a workspace.' };
  if (!/^[0-9]+$/.test(String(toRealm))) return { error: 'That is not a realm id.' };

  const taken = await pool.query('SELECT 1 FROM companies WHERE realm_id = $1', [toRealm]);
  if (taken.rowCount) return { taken: true };

  const cols = await pool.query(
    `SELECT c.table_name AS tbl, c.column_name AS col
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('realm_id', 'home_realm')`);

  const quote = s => '"' + String(s).replace(/"/g, '""') + '"';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of cols.rows) {
      if (r.tbl === 'companies') continue;        // the row itself goes last
      await client.query(
        `UPDATE ${quote(r.tbl)} SET ${quote(r.col)} = $2 WHERE ${quote(r.col)} = $1`,
        [fromId, toRealm]);
    }
    await client.query(
      'UPDATE companies SET realm_id = $2, updated_at = NOW() WHERE realm_id = $1',
      [fromId, toRealm]);
    await client.query('COMMIT');
    return { ok: true, moved: cols.rows.length };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* the trip is over anyway */ }
    throw e;
  } finally {
    client.release();
  }
}

// How long a deleted company can be put back. Said once, here, because the page
// that offers the delete and the sweep that finishes it must agree.
export const BIN_DAYS = 90;

// A company saved before its name could be read carries nothing, or the word
// 'null' written where a name should have been. Neither is a name to show.
function cleanName(n) {
  const s = String(n == null ? '' : n).trim();
  return (!s || s === 'null' || s === 'undefined') ? '' : s;
}

// Deleting, the way it is actually offered: the row is marked and the company
// drops out of every list and every query at once, while every parcel, order and
// run it owns stays exactly where it is. Nothing is destroyed for BIN_DAYS days.
export async function binCompany(realmId) {
  const r = await pool.query(
    `UPDATE companies SET deleted_at = NOW()
      WHERE realm_id = $1 AND deleted_at IS NULL RETURNING company_name`, [realmId]);
  return r.rowCount ? { ok: true, name: r.rows[0].company_name } : { error: 'No such company.' };
}

export async function unbinCompany(realmId) {
  const r = await pool.query(
    `UPDATE companies SET deleted_at = NULL
      WHERE realm_id = $1 AND deleted_at IS NOT NULL RETURNING company_name`, [realmId]);
  return r.rowCount ? { ok: true, name: r.rows[0].company_name } : { error: 'That company is not in the bin.' };
}

export async function listBinnedCompanies() {
  const r = await pool.query(
    `SELECT realm_id, company_name, refresh_token, deleted_at FROM companies
      WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`);
  return r.rows.map(x => ({
    realmId: x.realm_id,
    name: cleanName(x.company_name) || x.realm_id,
    connected: !isWorkspace(x.realm_id),
    deletedAt: x.deleted_at,
    // whole days left, never shown as less than none
    daysLeft: Math.max(0, BIN_DAYS -
      Math.floor((Date.now() - new Date(x.deleted_at).getTime()) / 86400000))
  }));
}

// What the bin is for, at the end of it. Run on startup and once a day after.
export async function emptyOldBin() {
  const r = await pool.query(
    `SELECT realm_id FROM companies
      WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${BIN_DAYS} days'`);
  const out = [];
  for (const row of r.rows) {
    try {
      await deleteCompany(row.realm_id);
      out.push(row.realm_id);
    } catch (e) {
      console.error('emptying the bin,', row.realm_id + ':', e.message);
    }
  }
  return out;
}

// Taking a company away for good, and everything that was ever written against
// it. Reached from the bin alone - by emptyOldBin() when the days are up.
//
// Which tables hold its work is read from the database rather than listed here,
// for the same reason graduateWorkspace() reads it: a table added next month would
// otherwise be left behind holding rows nobody can reach and nobody can see. The
// user ids that lived only in this company go with it - they were made for it and
// cannot be moved - while anybody with an address of their own simply loses this
// company off their list and keeps their account.
//
// One transaction: it all goes, or none of it does.
export async function deleteCompany(realmId) {
  const cols = await pool.query(
    `SELECT c.table_name AS tbl
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name = 'realm_id'
        AND c.table_name NOT IN ('companies', 'user_companies')`);

  const quote = s => '"' + String(s).replace(/"/g, '""') + '"';
  const client = await pool.connect();
  let rows = 0, ids = 0;
  try {
    await client.query('BEGIN');
    const gone = await client.query('DELETE FROM users WHERE home_realm = $1', [realmId]);
    ids = gone.rowCount;
    await client.query('DELETE FROM user_companies WHERE realm_id = $1', [realmId]);
    for (const r of cols.rows) {
      const out = await client.query(
        `DELETE FROM ${quote(r.tbl)} WHERE realm_id = $1`, [realmId]);
      rows += out.rowCount;
    }
    const co = await client.query('DELETE FROM companies WHERE realm_id = $1', [realmId]);
    if (!co.rowCount) {
      await client.query('ROLLBACK');
      return { error: 'No such company.' };
    }
    await client.query('COMMIT');
    return { ok: true, rows, ids, tables: cols.rows.length };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* the trip is over anyway */ }
    throw e;
  } finally {
    client.release();
  }
}

// A table that used to hold one run per company now holds one per person in it.
// This widens such a table in place: the column is added if it is not there, and
// the key moves from the company alone to the company and the person together.
// Rows written before the change keep an empty sign-in, which is nobody's desk,
// so an old run is never shown to someone as their own.
export async function keyRunsByDesk(table) {
  await pool.query(
    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS user_sub TEXT NOT NULL DEFAULT ''`);
  await pool.query(`
    DO $$
    DECLARE held text;
    BEGIN
      SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO held
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = '${table}'::regclass AND c.contype = 'p';

      IF held IS NULL THEN
        ALTER TABLE ${table} ADD PRIMARY KEY (realm_id, user_sub);
      ELSIF held = 'realm_id' THEN
        ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey;
        ALTER TABLE ${table} ADD PRIMARY KEY (realm_id, user_sub);
      END IF;
    END $$;
  `);
}
