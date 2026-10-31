// The banks, and what moves through them.
//
// Asked for on 30 Oct 2026, and the reason is the whole shape of it: the
// management wants one live report - every bank account, what is in it, what
// is still to come in, what has been paid and received **during the tax year**
// - and nobody wants to assemble that by hand from fifty accounts again.
//
// Where the figures come from, and it is deliberately three places and no more:
//
//   opening     typed once, when the bank is added, with the day it is true of.
//               Nothing before that day is ever counted - that is what makes
//               the balance trustworthy on the first morning.
//   in          the couriers. A receipt that has been paid is money that
//               landed in whichever bank that courier was paying into **on the
//               day it paid**, which is not always the bank it pays into now.
//   out         the spending sheet the company already keeps, read live.
//
// and two by hand, because no feed can know them: a transfer from one bank to
// another, and an adjustment.
//
// **The tax year is 1 July to 30 June**, and it is named by the year it ends
// in - 1 July 2025 to 30 June 2026 is tax year 2026. Every "during the year"
// figure on the report is cut by that and by nothing else.

import { pool } from './db.js';
import { buildReport, receiptProjection } from './banking-cprs.js';
import { addMoney } from './banking-money.js';

function calendarDay(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getFullYear() + '-' +
    String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  return String(value).slice(0, 10);
}

/* ==================== the tables ==================== */

export async function initBanking() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS banks (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      name          TEXT NOT NULL,
      owner_name    TEXT,                    -- whose name the account is in
      title         TEXT,                    -- the account title, as the bank has it
      account_no    TEXT,
      iban          TEXT,
      branch        TEXT,
      notes         TEXT,
      opening       NUMERIC(16,2),
      opening_on    DATE,
      sheet_url     TEXT,                    -- the spending sheet, published as CSV
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS banks_realm ON banks (realm_id, active)
  `);

  // A bank whose balance nobody has to hand yet is still a bank - it is added
  // now and the opening figure is typed in when somebody has the statement.
  // Until then it has none, which is a different thing from having nought.
  await pool.query(`ALTER TABLE banks ALTER COLUMN opening DROP NOT NULL`);
  await pool.query(`ALTER TABLE banks ALTER COLUMN opening_on DROP NOT NULL`);

  // **The time of day the opening balance is true of.**
  //
  // Asked for so it is plain which movements come after it. Every feed here
  // carries a **date and no clock** - a courier settles on a day, a spending
  // sheet is written by day - so the cut itself is still by day, and this is
  // the record of the moment rather than a filter. Said out loud on the screen,
  // because a field that looks like it filters and does not is worse than none.
  await pool.query(`ALTER TABLE banks ADD COLUMN IF NOT EXISTS opening_at TEXT`);

  // Every movement, whoever made it. `source` is who said so, and it is the
  // whole of the safety: a deposit the couriers wrote is replaced when they
  // say something different, and a figure somebody typed is never touched.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_moves (
      id            SERIAL PRIMARY KEY,
      realm_id      TEXT NOT NULL,
      bank_id       INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
      on_date       DATE NOT NULL,
      amount        NUMERIC(16,2) NOT NULL,   -- + into the bank, - out of it
      kind          TEXT NOT NULL,            -- courier | spend | transfer | adjust
      source        TEXT NOT NULL DEFAULT 'hand',  -- courier | sheet | hand
      ref           TEXT,                     -- the receipt number, or whatever names it
      account_id    INTEGER,                  -- the courier account it came from
      other_bank_id INTEGER,                  -- the other side of a transfer
      note          TEXT,
      made_by       TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // One deposit per receipt, **anywhere** - the bank is not part of the key on
  // purpose. If it were, correcting the date a bank was changed from would
  // leave the old deposit where it was and write a second one in the new bank,
  // and the same money would be in two accounts at once.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_moves_fed_key
      ON bank_moves (realm_id, source, ref)
     WHERE source <> 'hand' AND ref IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS bank_moves_read
      ON bank_moves (realm_id, bank_id, on_date)
  `);

  // Which bank a courier account pays into, and **from when**. A row is never
  // edited: changing the bank writes another row with its own date, so the
  // change is its own log and a payment made in October still lands where
  // October's money landed. That was asked for in those words - "mjy is
  // changes ki log bhe dikhai deti jay".
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bank_links (
      id          SERIAL PRIMARY KEY,
      realm_id    TEXT NOT NULL,
      account_id  INTEGER NOT NULL,
      bank_id     INTEGER NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
      from_date   DATE NOT NULL,
      note        TEXT,
      made_by     TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS bank_links_read
      ON bank_links (realm_id, account_id, from_date DESC)
  `);
}

/* ==================== small things ==================== */

const n2 = v => Math.round(Number(v || 0) * 100) / 100;
// CPR covers supply the bank net, including M&P's invoice recovery. Parcel
// pricing belongs to Logistics and is not a substitute for a bank deposit.

const num = v => {
  const f = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(f) ? 0 : f;
};

// Ten characters or nothing. A date on a form is a calendar date, not a
// moment - the lesson day() and qb_start both learned the hard way.
export function dayText(v) {
  const s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  return y >= 2000 && y <= 2100 ? s : null;
}

export function todayText() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// 1 July to 30 June, named by the year it ends in. Theirs, and the only year
// any of these figures are cut by.
export function taxYear(which) {
  const today = todayText();
  const y = Number(which) ||
    (today.slice(5) >= '07-01' ? Number(today.slice(0, 4)) + 1 : Number(today.slice(0, 4)));
  return { year: y, from: `${y - 1}-07-01`, to: `${y}-06-30` };
}

/* ==================== the banks ==================== */

export async function listBanks(realmId, opts) {
  const all = opts && opts.all;
  const r = await pool.query(
    `SELECT * FROM banks
      WHERE realm_id = $1 ${all ? '' : 'AND active IS TRUE'}
      ORDER BY active DESC, name`,
    [realmId]
  );
  return r.rows.map(shapeBank);
}

function shapeBank(b) {
  return {
    id: b.id,
    name: b.name,
    ownerName: b.owner_name || '',
    title: b.title || '',
    accountNo: b.account_no || '',
    iban: b.iban || '',
    branch: b.branch || '',
    notes: b.notes || '',
    // null, not nought: a bank nobody has given a figure for yet
    opening: b.opening == null ? null : String(b.opening),
    openingOn: calendarDay(b.opening_on),
    openingAt: b.opening_at || '',
    openingKnown: b.opening != null && !!b.opening_on,
    sheetUrl: b.sheet_url || '',
    active: b.active !== false
  };
}

export async function saveBank(realmId, bank) {
  const name = String(bank.name || '').trim();
  if (!name) throw new Error('The bank needs a name');

  // Both or neither. A figure with no day it is true of says nothing, and a
  // day with no figure is a bank waiting for its statement - which is allowed.
  const on = dayText(bank.openingOn);
  const hasFigure = bank.opening !== undefined && bank.opening !== null &&
                    String(bank.opening).trim() !== '';
  if (hasFigure && !on) {
    throw new Error('Give the day that opening balance is true of');
  }

  // hh:mm, or nothing. Kept as it was typed - it is a clock reading, not a
  // moment to be converted into another timezone.
  const at = /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(bank.openingAt || '').trim())
    ? String(bank.openingAt).trim() : null;

  const id = Number(bank.id) || 0;

  // The opening balance can be corrected, and it has to be - a figure typed
  // from the wrong statement is found a day later. What cannot be undone by
  // correcting it is the movements, which are rows of their own.
  if (id) {
    const r = await pool.query(
      `UPDATE banks SET name = $3, owner_name = $4, title = $5, account_no = $6,
              iban = $7, branch = $8, notes = $9, opening = $10, opening_on = $11,
              sheet_url = $12, active = $13, opening_at = $14
        WHERE realm_id = $1 AND id = $2 RETURNING id`,
      [realmId, id, name, bank.ownerName || null, bank.title || null,
       bank.accountNo || null, bank.iban || null, bank.branch || null,
       bank.notes || null, hasFigure ? num(bank.opening) : null, on,
       bank.sheetUrl || null, bank.active !== false, at]
    );
    if (!r.rows.length) throw new Error('No such bank');
    return id;
  }

  const r = await pool.query(
    `INSERT INTO banks (realm_id, name, owner_name, title, account_no, iban,
                        branch, notes, opening, opening_on, sheet_url, opening_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [realmId, name, bank.ownerName || null, bank.title || null,
     bank.accountNo || null, bank.iban || null, bank.branch || null,
     bank.notes || null, hasFigure ? num(bank.opening) : null, on,
     bank.sheetUrl || null, at]
  );
  return r.rows[0].id;
}

// A bank is switched off, never deleted: its movements are the history of
// money that actually moved, and a year's balances are read back from them.
export async function closeBank(realmId, id) {
  const r = await pool.query(
    `UPDATE banks SET active = FALSE WHERE realm_id = $1 AND id = $2`,
    [realmId, Number(id)]
  );
  return r.rowCount;
}

/* ==================== which bank a courier pays into ==================== */

export async function listLinks(realmId, accountId) {
  const where = ['l.realm_id = $1'];
  const args = [realmId];
  if (accountId) { args.push(Number(accountId)); where.push(`l.account_id = $${args.length}`); }

  const r = await pool.query(
    `SELECT l.*, b.name AS bank_name, a.label AS account_label, a.courier
       FROM bank_links l
       JOIN banks b ON b.id = l.bank_id
       LEFT JOIN courier_accounts a ON a.id = l.account_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.account_id, l.from_date DESC, l.id DESC`,
    args
  );

  return r.rows.map(x => ({
    id: x.id,
    accountId: x.account_id,
    accountLabel: x.account_label || '',
    courier: x.courier || '',
    bankId: x.bank_id,
    bankName: x.bank_name,
    from: calendarDay(x.from_date),
    note: x.note || '',
    madeBy: x.made_by || '',
    madeAt: x.created_at
  }));
}

// Changing the bank is writing the next row, never editing the last one. The
// old row is what says where October's money went.
export async function linkBank(realmId, { accountId, bankId, from, note, by }) {
  const on = dayText(from);
  if (!on) throw new Error('From which date does this bank take the payments?');
  if (!Number(accountId)) throw new Error('Which courier account?');
  if (!Number(bankId)) throw new Error('Which bank?');

  const r = await pool.query(
    `INSERT INTO bank_links (realm_id, account_id, bank_id, from_date, note, made_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [realmId, Number(accountId), Number(bankId), on, note || null, by || null]
  );
  return r.rows[0].id;
}

export async function unlink(realmId, id) {
  const r = await pool.query(
    `DELETE FROM bank_links WHERE realm_id = $1 AND id = $2`, [realmId, Number(id)]
  );
  return r.rowCount;
}

/* ==================== the couriers' money, into the banks ==================== */
//
// One receipt is one deposit. It is written against the bank that account was
// paying into **on the day the receipt was paid**, which is the whole point of
// the dated link: a bank changed on 1 November does not move October's money.
//
// Nothing before a bank's own opening date is ever written, because that day's
// balance was typed in as a fact and the statement behind it already counts
// whatever came before - "yad rhy ky wo balance ky pichy wali transaction bank
// na uthay".

// Courier deposits are now a live read of CPR covers. Do not rewrite or
// delete historical bank_moves; the report replaces their old COD projection
// with the current receipt net and status. Existing endpoint remains compatible.
export async function postDeposits(realmId) {
  const data = await receiptProjection(realmId, await listBanks(realmId, { all: true }), todayText());
  return data.receipts.filter(r => r.included && r.state === 'received').length;
}

export async function homeless(realmId) {
  const data = await receiptProjection(realmId, await listBanks(realmId, { all: true }), todayText());
  const byAccount = new Map();
  for (const r of data.receipts.filter(r => !r.included && r.state === 'received')) {
    const key = r.accountId + ':' + r.why;
    const row = byAccount.get(key) || { accountId: r.accountId, label: r.account,
      courier: r.courier, receipts: 0, values: [], why: r.why };
    row.receipts++;
    row.values.push(r.net);
    byAccount.set(key, row);
  }
  return [...byAccount.values()].map(({ values, ...row }) => ({ ...row, net: addMoney(values) }));
}

/* ==================== by hand: transfers and adjustments ==================== */

export async function transfer(realmId, { fromBank, toBank, on, amount, note, by }) {
  const day = dayText(on);
  if (!day) throw new Error('Which day?');
  const value = num(amount);
  if (!value) throw new Error('How much?');
  if (!Number(fromBank) || !Number(toBank)) throw new Error('From which bank, to which?');
  if (Number(fromBank) === Number(toBank)) throw new Error('That is the same bank twice');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO bank_moves (realm_id, bank_id, on_date, amount, kind, source,
                               other_bank_id, note, made_by)
       VALUES ($1,$2,$3,$4,'transfer','hand',$5,$6,$7)`,
      [realmId, Number(fromBank), day, -Math.abs(value), Number(toBank), note || null, by || null]
    );
    await client.query(
      `INSERT INTO bank_moves (realm_id, bank_id, on_date, amount, kind, source,
                               other_bank_id, note, made_by)
       VALUES ($1,$2,$3,$4,'transfer','hand',$5,$6,$7)`,
      [realmId, Number(toBank), day, Math.abs(value), Number(fromBank), note || null, by || null]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return true;
}

// An entry somebody makes themselves: a correction, a charge the sheet does
// not carry, money in from somewhere that is not a courier. The sign is the
// person's own - a minus takes it off.
export async function adjust(realmId, { bankId, on, amount, note, by }) {
  const day = dayText(on);
  if (!day) throw new Error('Which day?');
  const value = num(amount);
  if (!value) throw new Error('How much?');
  if (!Number(bankId)) throw new Error('Which bank?');
  if (!String(note || '').trim()) throw new Error('Say what this entry is for');

  const r = await pool.query(
    `INSERT INTO bank_moves (realm_id, bank_id, on_date, amount, kind, source, note, made_by)
     VALUES ($1,$2,$3,$4,'adjust','hand',$5,$6) RETURNING id`,
    [realmId, Number(bankId), day, value, String(note).trim(), by || null]
  );
  return r.rows[0].id;
}

// A payment that went to the bank the courier was told to stop using. It
// happens every time a bank is changed, so it is a move of its own rather than
// an adjustment with a sentence under it.
export async function moveDeposit(realmId, { moveId, toBank, by }) {
  const r = await pool.query(
    `UPDATE bank_moves
        SET bank_id = $3, note = COALESCE(note,'') || ' (moved from another bank)',
            made_by = COALESCE($4, made_by)
      WHERE realm_id = $1 AND id = $2
      RETURNING id`,
    [realmId, Number(moveId), Number(toBank), by || null]
  );
  if (!r.rows.length) throw new Error('No such entry');
  return true;
}

export async function dropMove(realmId, id) {
  const r = await pool.query(
    `DELETE FROM bank_moves
      WHERE realm_id = $1 AND id = $2 AND source = 'hand'`,
    [realmId, Number(id)]
  );
  if (!r.rowCount) throw new Error('Only an entry somebody made by hand can be removed');
  return true;
}

/* ==================== what is still to come in ==================== */
//
// Receivable is the couriers' - money collected at the door, less what they
// kept, that has not been paid out yet. It belongs to the bank that courier
// pays into **now**, because that is where it will land.

export async function receivable(realmId) {
  const data = await receiptProjection(realmId, await listBanks(realmId, { all: true }), todayText());
  const out = new Map();
  for (const r of data.receipts.filter(r => r.included && r.state === 'receivable')) {
    const row = out.get(r.bankId) || { owed: '0.00', cprs: 0 };
    row.owed = addMoney([row.owed, r.net]);
    row.cprs++;
    out.set(r.bankId, row);
  }
  return out;
}

export async function report(realmId, opts = {}) {
  return buildReport(realmId, { banks: await listBanks(realmId, { all: true }),
    year: taxYear(opts.year), today: todayText(), parseSheet: readSpendSheet,
    fresh: !!opts.fresh, allMoves: !!opts.allMoves });
}

export async function bankSheet(realmId, bankId, opts = {}) {
  const data = await report(realmId, { ...opts, allMoves: true });
  const bank = data.banks.find(b => b.id === Number(bankId));
  if (!bank) throw new Error('No such bank');
  const from = dayText(opts.from) || data.year.from;
  const to = dayText(opts.to) || data.year.to;
  return { bank, year: data.year, warnings: data.warnings,
    receipts: data.receipts.filter(r => r.bankId === bank.id),
    moves: data.moves.filter(m => m.bankId === bank.id && m.on >= from && m.on <= to).slice(0, 500) };
}

/* ==================== the spending sheet ==================== */
//
// What goes **out** of a bank is already written down every day, in the
// company's own Google Sheet. Asking anybody to type it twice would be the
// surest way to have two different answers, so the sheet is read as it is:
// File -> Share -> Publish to the web -> **Comma-separated values (.csv)**,
// and that address goes on the bank.
//
// Three columns are looked for by their headings, in whatever order they sit:
// a date, an amount, and something that says what it was for. Everything else
// in the sheet is ignored, so it can go on being whatever shape suits the
// person keeping it.
//
// A row is written down once, and its key is the day, the amount and the
// words. So a row taken out of the sheet is taken off the bank too - the sheet
// stays the record rather than becoming a one-way import - and two genuinely
// identical payments on one day are one row here. That is the trade for not
// needing a column nobody keeps.

const SHEET_CACHE = new Map();
const SHEET_LIFE = 5 * 60 * 1000;

function cell(v) { return String(v == null ? '' : v).trim(); }

// A CSV line, with quotes understood. Written out rather than split on commas,
// because a spending sheet has "Fuel, Lahore" in it and a plain split turns
// that into two columns and a wrong amount.
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Their own date, read by hand and never through new Date(): a sheet written
// here says 05/07/2026 and that is the 5th of July.
function sheetDay(v) {
  const s = cell(v);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const dd = a > 12 ? a : (b > 12 ? b : a);
    const mm = a > 12 ? b : (b > 12 ? a : b);
    return m[3] + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }
  return null;
}

function keyOf(day, amount, note) {
  const s = day + '|' + amount.toFixed(2) + '|' + note.toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'sheet:' + h.toString(16) + ':' + day;
}

export function readSpendSheet(text) {
  const rows = csvRows(String(text || ''));
  if (!rows.length) return { rows: [], trouble: 'the sheet came back empty' };

  let head = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const words = rows[i].map(x => cell(x).toLowerCase());
    if (words.some(w => /date|day|tareekh/.test(w)) &&
        words.some(w => /amount|amt|rs|rupee|paid|debit|spend|kharch/.test(w))) {
      head = i; break;
    }
  }
  if (head < 0) return { rows: [], trouble: 'no heading row with a date and an amount in it' };

  const words = rows[head].map(x => cell(x).toLowerCase());
  const find = re => words.findIndex(w => re.test(w));
  const iDay = find(/date|day|tareekh/);
  const iAmt = find(/amount|amt|^rs$|rupee|debit|paid|spend|kharch/);
  const iFor = find(/detail|particular|descri|note|purpose|head|narration|reason/);

  const out = [];
  let invalidRows = 0;
  for (let i = head + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.some(v => cell(v))) continue;
    // Footer totals are not transactions. An unreadable expense must be
    // reported, rather than disappearing from a live balance.
    if (!cell(r[iDay]) && /total|balance/i.test(r.map(cell).join(' '))) continue;
    const day = sheetDay(r[iDay]);
    const amount = Math.abs(num(r[iAmt]));
    if (!day || !cell(r[iAmt]) || !Number.isFinite(amount) ||
        !/\d/.test(cell(r[iAmt]))) { invalidRows++; continue; }
    if (!amount) continue;
    const note = cell(iFor > -1 ? r[iFor] : '') || 'spending';
    out.push({ day: day, amount: n2(amount), note: note, key: keyOf(day, amount, note) });
  }
  return { rows: out, trouble: invalidRows ? invalidRows + ' spending row(s) could not be read' : null };
}

// Read the sheet and write what is in it, for one bank.
export async function pullSheet(realmId, bankId, opts) {
  const id = Number(bankId);
  const b = (await pool.query(
    'SELECT sheet_url, opening_on FROM banks WHERE realm_id = $1 AND id = $2',
    [realmId, id])).rows[0];
  if (!b) throw new Error('No such bank');
  if (!b.sheet_url) throw new Error('This bank has no spending sheet on it yet');

  const key = realmId + ':' + id;
  const kept = SHEET_CACHE.get(key);
  if (kept && !(opts && opts.fresh) && Date.now() - kept.at < SHEET_LIFE) return kept.out;

  let text;
  try {
    const r = await fetch(b.sheet_url, { headers: { Accept: 'text/csv,*/*' } });
    if (!r.ok) throw new Error('the sheet answered ' + r.status);
    text = await r.text();
  } catch (e) {
    throw new Error('The spending sheet could not be read: ' + e.message +
      '. It has to be published to the web as CSV, not only shared.');
  }

  if (/<html/i.test(text.slice(0, 400))) {
    throw new Error('That address gave back a web page, not a CSV. In Google ' +
      'Sheets: File > Share > Publish to the web > Comma-separated values (.csv).');
  }

  const read = readSpendSheet(text);
  if (read.trouble) throw new Error(read.trouble);
  const opening = calendarDay(b.opening_on);
  const rows = read.rows.filter(x => !opening || x.day >= opening);

  const client = await pool.connect();
  let written = 0, gone = 0;
  try {
    await client.query('BEGIN');

    for (const x of rows) {
      await client.query(
        `INSERT INTO bank_moves (realm_id, bank_id, on_date, amount, kind, source, ref, note)
         VALUES ($1,$2,$3,$4,'spend','sheet',$5,$6)
         ON CONFLICT (realm_id, source, ref)
           WHERE source <> 'hand' AND ref IS NOT NULL
           DO UPDATE SET amount = EXCLUDED.amount, on_date = EXCLUDED.on_date,
                         bank_id = EXCLUDED.bank_id, note = EXCLUDED.note`,
        [realmId, id, x.day, -Math.abs(x.amount), x.key, x.note]
      );
      written++;
    }

    const keys = rows.map(x => x.key);
    const cut = await client.query(
      `DELETE FROM bank_moves
        WHERE realm_id = $1 AND bank_id = $2 AND source = 'sheet'
          AND NOT (ref = ANY($3::text[]))`,
      [realmId, id, keys.length ? keys : ['']]
    );
    gone = cut.rowCount;

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const out = {
    read: read.rows.length,
    written: written,
    gone: gone,
    before: read.rows.length - rows.length,
    trouble: read.trouble,
    at: new Date().toISOString()
  };
  SHEET_CACHE.set(key, { at: Date.now(), out });
  return out;
}
