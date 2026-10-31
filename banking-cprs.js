// Read-only Banking projection. Historical generated bank_moves are retained,
// but receipt covers (not those old COD sums) are the source of courier money.
import { pool } from './db.js';
import { bankingReceipts, bankingReceiptOrders } from './couriers.js';
import { cprDetail } from './cprlive.js';
import { addMoney, bankFigures, placeReceipts } from './banking-money.js';

const sheets = new Map();
const pendingSheets = new Map();
const SHEET_LIFE = 60 * 1000;

export async function liveSpend(realmId, bank, parseSheet, fresh = false) {
  const key = JSON.stringify([realmId, bank.id, bank.sheetUrl]);
  const kept = sheets.get(key);
  if (!fresh && kept && Date.now() - kept.at < SHEET_LIFE) return kept.value;
  if (pendingSheets.has(key)) return pendingSheets.get(key);
  const work = (async () => {
    const response = await fetch(bank.sheetUrl, {
      headers: { Accept: 'text/csv,*/*' }, signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Spending sheet answered ' + response.status);
    const text = await response.text();
    if (/<html/i.test(text.slice(0, 400))) throw new Error('Spending sheet returned HTML; publish it as CSV');
    const result = parseSheet(text);
    if (result.trouble) throw new Error(result.trouble);
    const unique = new Map();
    result.rows.forEach(r => unique.set(r.key, { on: r.day,
      amount: addMoney(['0', '-' + String(r.amount).replace(/^-/, '')]),
      note: r.note, ref: r.key, kind: 'spend', source: 'sheet', bankId: bank.id }));
    const value = [...unique.values()];
    sheets.set(key, { at: Date.now(), value });
    while (sheets.size > 100) sheets.delete(sheets.keys().next().value);
    return value;
  })();
  pendingSheets.set(key, work);
  try { return await work; } finally { pendingSheets.delete(key); }
}

export async function receiptProjection(realmId, banks, today) {
  const [receipts, linkRows, moveRows] = await Promise.all([
    bankingReceipts(realmId),
    pool.query(`SELECT id, account_id, bank_id, to_char(from_date,'YYYY-MM-DD') AS from_day
                  FROM bank_links WHERE realm_id = $1`, [realmId]),
    pool.query(`SELECT id, bank_id, account_id, to_char(on_date,'YYYY-MM-DD') AS day,
                       amount, kind, source, ref, note, made_by, other_bank_id
                  FROM bank_moves WHERE realm_id = $1`, [realmId])
  ]);
  const links = linkRows.rows.map(l => ({ id: Number(l.id), accountId: Number(l.account_id),
    bankId: Number(l.bank_id), from: l.from_day }));
  const moves = moveRows.rows.map(m => ({ id: m.id, bankId: Number(m.bank_id),
    accountId: Number(m.account_id), on: m.day, amount: m.amount,
    kind: m.kind, source: m.source, ref: m.ref || '', note: m.note || '',
    madeBy: m.made_by || '', otherBankId: m.other_bank_id }));
  return { receipts: placeReceipts(receipts, banks, links, moves, today), moves };
}

export async function buildReport(realmId, { banks, year, today, parseSheet, fresh, allMoves }) {
  const data = await receiptProjection(realmId, banks, today);
  const warnings = [];
  const sheetMoves = await Promise.all(banks.map(async b => {
    if (!b.sheetUrl) return [];
    try { return await liveSpend(realmId, b, parseSheet, fresh); }
    catch (e) { warnings.push({ bankId: b.id, bank: b.title || b.name, message: e.message }); return []; }
  }));
  const linkedSheets = new Set(banks.filter(b => b.sheetUrl).map(b => b.id));
  const moves = [
    ...data.moves.filter(m => m.source !== 'courier' &&
      !(m.source === 'sheet' && linkedSheets.has(m.bankId))),
    ...sheetMoves.flat()
  ];
  const rows = banks.map(b => {
    const receipts = data.receipts.filter(r => r.bankId === b.id && r.included);
    const ownMoves = moves.filter(m => m.bankId === b.id);
    const figures = bankFigures(b, receipts, ownMoves, year, today);
    const failed = warnings.some(w => w.bankId === b.id);
    const uncertain = data.receipts.some(r => r.bankId === b.id && !r.included &&
      (r.state === 'unknown' || r.why === 'Net amount not supplied' ||
       r.why === 'Payment date not supplied'));
    const paid = receipts.filter(r => r.state === 'received' && r.on <= today &&
      r.on >= year.from && r.on <= year.to);
    const dates = [...ownMoves.map(m => m.on), ...paid.map(r => r.on)]
      .filter(d => d && d <= today).sort();
    return { ...b, ...figures, balance: failed || uncertain ? null : figures.balance,
      balanceIncomplete: failed || uncertain, expenseIncomplete: failed,
      fromCouriersYear: addMoney(paid.map(r => r.net)),
      receivedCprs: paid.length,
      receivableCprs: receipts.filter(r => r.state === 'receivable').length,
      lastOn: dates.at(-1) || null };
  });
  const total = key => addMoney(rows.map(b => b[key]));
  const byBank = new Map(rows.map(b => [b.id, b]));
  const movementRows = moves.filter(m => {
    const b = byBank.get(m.bankId);
    return b && m.on <= today && (!b.openingOn || m.on >= b.openingOn);
  }).map(m => ({ ...m, bank: byBank.get(m.bankId)?.title || byBank.get(m.bankId)?.name,
    status: 'Recorded', account: '', amount: String(m.amount) }));
  const cprMoves = data.receipts.filter(r => r.bankId && r.state !== 'excluded' &&
    (r.included || r.state === 'unknown')).map(r => ({
      bankId: r.bankId, bank: r.bank, on: r.on || r.createdOn || '',
      amount: r.net, kind: 'courier', source: 'courier', ref: r.cpr,
      accountId: r.accountId, account: r.account, status: r.status || 'Unknown',
      state: r.state, note: '', affectsBalance: r.state === 'received' && r.included
    }));
  return { year, banks: rows, today, warnings,
    totals: { opening: total('opening'),
      balance: rows.some(b => b.balance == null) ? null : total('balance'),
      inYear: rows.some(b => b.balanceIncomplete) ? null : total('inYear'),
      outYear: warnings.length ? null : total('outYear'),
      received: total('fromCouriersYear'), receivable: total('receivable'), payable: null },
    receipts: data.receipts,
    moves: [...movementRows, ...cprMoves].sort((a, b) => b.on.localeCompare(a.on) ||
      String(b.ref).localeCompare(String(a.ref))).slice(0, allMoves ? undefined : 60),
    // A count is accompanied by its exact cause instead of a hidden zero.
    unplaced: data.receipts.filter(r => !r.included && r.state !== 'excluded')
  };
}

export async function receiptDetail(realmId, accountId, cpr) {
  const receipt = (await bankingReceipts(realmId)).find(r =>
    r.accountId === Number(accountId) && r.cpr === String(cpr));
  if (!receipt) throw new Error('No such CPR in this company');
  let orders = await bankingReceiptOrders(realmId, accountId, cpr);
  let summary = { gross: receipt.gross, charges: receipt.charges, tax: receipt.tax,
    withholding: receipt.withholding, net: receipt.net };
  let adjustments = [];
  let warning = '';
  if (receipt.courier === 'postex' && receipt.remoteId) {
    try {
      const live = await cprDetail(realmId, accountId, receipt.remoteId, receipt.createdOn);
      const s = live.summary;
      summary = { gross: s.grandTotal, charges: addMoney([s.codCharges, s.upfrontCharges]),
        tax: s.tax, withholding: addMoney([s.salesTax, s.incomeTax]), net: receipt.net,
        salesTax: s.salesTax, incomeTax: s.incomeTax, miscellaneous: s.miscellaneousCharges,
        carryForward: s.carryForwardAmount, adjustment: s.adjustmentAmount };
      adjustments = live.adjustments;
      orders = live.orders;
    } catch (e) { warning = 'Live courier detail unavailable; showing saved data: ' + e.message; }
  }
  const expected = receipt.orders;
  if (expected != null && orders.length < expected) {
    warning += (warning ? '. ' : '') + orders.length + ' of ' + expected + ' orders available';
  }
  const gap = [summary.gross, summary.net, summary.charges, summary.tax, summary.withholding]
    .some(v => v == null || Number(v) < 0) ? null : addMoney([summary.gross,
    '-' + String(summary.net).replace(/^-/, ''),
    ...[summary.charges, summary.tax, summary.withholding].map(v =>
      '-' + String(v ?? 0).replace(/^-/, ''))]);
  return { receipt, summary: { ...summary, otherDifference: gap }, orders, adjustments, warning };
}
