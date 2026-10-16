import { pool, isWorkspace } from './db.js';

// A company saved before its name could be read carries nothing, or the word
// 'null' written where a name should have been. Neither is a name to show.
function nameOf(n) {
  const s = String(n == null ? '' : n).trim();
  return (!s || s === 'null' || s === 'undefined') ? '' : s;
}


// Every company the app holds, whether or not it has books yet.
//
// Two kinds of row count. One is a set of books: a realm number QuickBooks would
// recognise and a key to reach it with. The other is a company somebody made by
// signing up, which has an id of ours and no key at all - and it counts, because
// the couriers, the Shopify side and the people all live in it. A row that is
// neither is wreckage from a sign-in that went wrong, and has no business being
// offered to anybody.
//
// `connected` is the one difference, and it is said here rather than worked out
// again by every caller: it is what decides whether QuickBooks can be asked
// anything at all.
export async function listCompanies() {
  const r = await pool.query(
    'SELECT realm_id, company_name, refresh_token, updated_at FROM companies ORDER BY company_name NULLS LAST'
  );
  return r.rows
    .filter(x => isWorkspace(x.realm_id) ||
      (/^[0-9]+$/.test(String(x.realm_id || '')) && x.refresh_token))
    .map(x => ({
      realmId: x.realm_id,
      name: nameOf(x.company_name) || x.realm_id,
      connected: !isWorkspace(x.realm_id),
      updatedAt: x.updated_at
    }));
}
