// Read-only Banking projection. Historical generated bank_moves are retained,
// but receipt covers (not those old COD sums) are the source of courier money.
import { pool } from './db.js';
import { bankingReceipts, bankingReceiptOrders } from './couriers.js';
import { cprDetail } from './cprlive.js';
import { mnpReceiptDetail } from './mnplive.js';
import { addMoney, bankFigures, placeReceipts, reportTotals } from './banking-money.js';
import { googleSheetId, googleSpend } from './banking-sheets.js';
import { archiveReady, retainCovers, savedReceipts, mergeReceipts, loadDetail, retainDetail, archiveCandidates, deferArchive } from './banking-archive.js';
import { mayRun, beginBackground, endBackground, nextGapMinutes } from './compute.js';

const sheets = new Map();
const pendingSheets = new Map();
const SHEET_LIFE = 60 * 1000;

export async function liveSpend(realmId, bank, parseSheet, fresh = false, today = new Date().toISOString().slice(0,10)) {
  if(googleSheetId(bank.sheetUrl)) {
    const rows=await googleSpend(realmId,bank,today,fresh);
    return rows.map(r=>({...r,on:r.day,amount:addMoney(['-'+r.amount]),ref:r.key,
      kind:'spend',source:'sheet',bankId:bank.id}));
  }
  const key = JSON.stringify([realmId, bank.id, bank.sheetUrl, bank.name]);
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
    const result = parseSheet(text, bank);
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
  const readAt=new Date().toISOString();
  const [currentReceipts, linkRows, moveRows] = await Promise.all([
    bankingReceipts(realmId),
    pool.query(`SELECT id, account_id, bank_id, to_char(from_date,'YYYY-MM-DD') AS from_day
                  FROM bank_links WHERE realm_id = $1`, [realmId]),
    pool.query(`SELECT id, bank_id, account_id, to_char(on_date,'YYYY-MM-DD') AS day,
                       amount, kind, source, ref, note, made_by, other_bank_id
                  FROM bank_moves WHERE realm_id = $1
                    AND NOT EXISTS (SELECT 1 FROM banking_entry_audit a,
                      LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a.new_value)='array'
                        THEN a.new_value ELSE '[]'::jsonb END) e
                      WHERE a.realm_id=$1 AND a.action LIKE 'reverse:%'
                        AND (e->>'id'=bank_moves.id::text OR e->>'reversesMoveId'=bank_moves.id::text))`, [realmId])
  ]);
  let receipts=currentReceipts,archive=null;
  if(archiveReady()){
    await retainCovers(realmId,currentReceipts,readAt);
    const saved=await savedReceipts(realmId);
    receipts=mergeReceipts(saved,currentReceipts);
    archive={receipts:saved.length,details:saved.filter(r=>r.archiveComplete).length};
  }
  const links = linkRows.rows.map(l => ({ id: Number(l.id), accountId: Number(l.account_id),
    bankId: Number(l.bank_id), from: l.from_day }));
  const moves = moveRows.rows.map(m => ({ id: m.id, bankId: Number(m.bank_id),
    accountId: Number(m.account_id), on: m.day, amount: m.amount,
    kind: m.kind, source: m.source, ref: m.ref || '', note: m.note || '',
    madeBy: m.made_by || '', otherBankId: m.other_bank_id }));
  return { receipts: placeReceipts(receipts, banks, links, moves, today), moves, archive };
}

export async function buildReport(realmId, { banks, year, today, parseSheet, fresh, allMoves }) {
  const data = await receiptProjection(realmId, banks, today);
  const warnings = [];
  const sheetMoves = await Promise.all(banks.map(async b => {
    if (!b.sheetUrl) return [];
    const id=googleSheetId(b.sheetUrl);
    if(id && banks.some(other=>other.id!==b.id && googleSheetId(other.sheetUrl)===id &&
      other.name.trim().toLowerCase()===b.name.trim().toLowerCase())) {
      warnings.push({bankId:b.id,bank:b.title||b.name,message:'Duplicate Bank Name for the same Google Sheet; use distinct exact sender names to prevent double counting'});
      return [];
    }
    try { return await liveSpend(realmId, b, parseSheet, fresh, today); }
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
    const uncertain = data.receipts.some(r => r.bankId === b.id && !r.nonCash && !r.included &&
      (r.state === 'unknown' || r.why === 'Net amount not supplied' ||
       r.why === 'Payment date not supplied'));
    const paid = receipts.filter(r => r.state === 'received' && r.on <= today &&
      r.on >= year.from && r.on <= year.to);
    const dates = [...ownMoves.map(m => m.on), ...paid.map(r => r.on)]
      .filter(d => d && d <= today).sort();
    return { ...b, ...figures, balance: failed || uncertain ? null : figures.balance,
      balanceIncomplete: failed || uncertain, expenseIncomplete: failed,
      incomeIncomplete: uncertain,
      fromCouriersYear: addMoney(paid.filter(r => !r.nonCash).map(r => r.net)),
      receivedCprs: paid.length,
      receivableCprs: receipts.filter(r => r.state === 'receivable').length,
      lastOn: dates.at(-1) || null };
  });
  const byBank = new Map(rows.map(b => [b.id, b]));
  const movementRows = moves.filter(m => {
    const b = byBank.get(m.bankId);
    return b && m.on <= today && (m.source==='hand' ||
      m.on>=((Number(m.amount)<0?b.sheetFrom||b.outFrom:b.inFrom)||b.openingOn||''));
  }).map(m => ({ ...m, bank: byBank.get(m.bankId)?.title || byBank.get(m.bankId)?.name,
    status: 'Recorded', account: '', amount: String(m.amount) }));
  const cprMoves = data.receipts.filter(r => r.bankId && r.state !== 'excluded' &&
    (r.included || r.state === 'unknown')).map(r => ({
      bankId: r.bankId, bank: r.bank, on: r.on || r.createdOn || '',
      amount: r.net, kind: 'courier', source: 'courier', ref: r.cpr,
      accountId: r.accountId, account: r.account, status: r.status || 'Unknown',
      state: r.state, note: '', affectsBalance: r.state === 'received' && r.included && !r.nonCash
    }));
  queueArchiveDetails(realmId);
  return { year, banks: rows, today, warnings, archive:data.archive,
    totals: reportTotals(rows),
    receipts: data.receipts,
    moves: [...movementRows, ...cprMoves].sort((a, b) => b.on.localeCompare(a.on) ||
      String(b.ref).localeCompare(String(a.ref))).slice(0, allMoves ? undefined : 60),
    // A count is accompanied by its exact cause instead of a hidden zero.
    unplaced: data.receipts.filter(r => !r.nonCash && !r.included && r.state !== 'excluded')
  };
}

export async function receiptDetail(realmId, accountId, cpr) {
  const current=await bankingReceipts(realmId);
  let receipts=current,saved=null;
  if(archiveReady()){
    await retainCovers(realmId,current);
    receipts=mergeReceipts(await savedReceipts(realmId),current);
    saved=await loadDetail(realmId,accountId,cpr);
  }
  const receipt = receipts.find(r =>
    r.accountId === Number(accountId) && r.cpr === String(cpr));
  if (!receipt) throw new Error('No such CPR in this company');
  if(saved?.complete)return {...saved.value,receipt,archive:{savedAt:saved.savedAt,complete:true}};
  let orders = await bankingReceiptOrders(realmId, accountId, cpr);
  let summary = { gross: receipt.gross, charges: receipt.charges, tax: receipt.tax,
    withholding: receipt.withholding, bankFee: receipt.bankFee, net: receipt.net };
  let adjustments = [];
  let warning = '';
  let liveDetail=false;
  if(saved && saved.value.orders.length>=orders.length){
    orders=saved.value.orders;summary={...saved.value.summary,...Object.fromEntries(Object.entries(summary).filter(([,v])=>v!=null))};
    adjustments=saved.value.adjustments||[];
  }
  if (!receipt.archived && receipt.courier === 'postex' && receipt.remoteId) {
    try {
      const live = await cprDetail(realmId, accountId, receipt.remoteId, receipt.createdOn);
      const s = live.summary;
      summary = { gross: s.grandTotal, charges: addMoney([s.codCharges, s.upfrontCharges]),
        tax: s.tax, withholding: addMoney([s.salesTax, s.incomeTax]), net: receipt.net,
        salesTax: s.salesTax, incomeTax: s.incomeTax, miscellaneous: s.miscellaneousCharges,
        carryForward: s.carryForwardAmount, adjustment: s.adjustmentAmount };
      adjustments = live.adjustments;
      orders = live.orders;
      liveDetail=true;
    } catch (e) { warning = 'Live courier detail unavailable; showing saved data: ' + e.message; }
  }
  if (!receipt.archived && receipt.courier === 'mnp') {
    try {
      const live = await mnpReceiptDetail(realmId, accountId, receipt.cpr);
      summary = { ...live.summary, bankFee: receipt.bankFee };
      orders = live.orders;
      liveDetail=true;
      receipt.paidToBank = live.paidToBank || receipt.paidToBank;
      receipt.paidToAccount = live.paidToAccount || receipt.paidToAccount;
      if (addMoney([summary.net]) !== addMoney([receipt.net])) {
        warning = 'Courier summary differs from saved CPR; refresh this courier account to update the bank report';
      }
    } catch (e) { warning = 'Live M&P detail unavailable; showing saved data: ' + e.message; }
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
  const result={ receipt, summary: { ...summary, otherDifference: gap }, orders, adjustments, warning };
  if(archiveReady()){
    const complete=!warning && (liveDetail || !['postex','mnp'].includes(receipt.courier) && expected!=null && orders.length>=expected) &&
      (expected==null?orders.length>0:orders.length>=expected);
    try{
      const stored=await retainDetail(realmId,result,complete);
      result.archive={savedAt:stored?new Date().toISOString():saved?.savedAt||null,complete:stored?complete:!!saved?.complete};
    }catch(e){result.warning+=(result.warning?'. ':'')+'Banking archive save failed; retry before disconnecting the courier';}
  }
  return result;
}

// No new poller: existing Banking reads trigger at most two missing details,
// paced and measured through the existing compute budget. Failed portals back off.
let archiveRunning=false;
const archiveAfter=new Map();
function queueArchiveDetails(realm){
  if(!archiveReady()||archiveRunning||Date.now()<(archiveAfter.get(realm)||0)||!mayRun().ok)return;
  archiveRunning=true;archiveAfter.set(realm,Date.now()+Math.max(15,nextGapMinutes())*60000);
  while(archiveAfter.size>100)archiveAfter.delete(archiveAfter.keys().next().value);
  const mark=beginBackground();
  Promise.resolve().then(async()=>{
    for(const row of await archiveCandidates(realm)){
      if(!mayRun().ok)break;
      try{await receiptDetail(realm,row.account_id,row.cpr_number);}
      finally{await deferArchive(realm,row.account_id,row.cpr_number);}
    }
  }).catch(()=>{}).finally(()=>{archiveRunning=false;endBackground(mark);});
}
