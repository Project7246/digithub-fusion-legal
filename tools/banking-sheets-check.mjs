// Synthetic workbook only; no Google account or database is contacted.
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { workbookSpend } from '../banking-sheets.js';
const wb = XLSX.utils.book_new();
const values = [['Date','Receiver Information','','','','','Sender Information'],
  ['Date','Bank Name','Beneficiary Name','Amount Received','Amount Sent','Payable','Sender Bank Account','Reference ID','Transfer Methods','QBO Status','Assigned to','Apportionment','Narration'],
  ['19/10/2026','Other bank','Supplier','',100,0,'My bank','old','','Posted','','','Old'],
  ['20/10/2026','Other bank','Supplier',999,200,0,'My bank','REF-1','','Posted','','','Delivery bill paid separately'],
  ['20/10/2026','My bank','Supplier','',900,0,'Another bank','REF-2'],
  ['21/10/2026','Other bank','Supplier','',200,0,'My bank','REF-3']];
const ws = XLSX.utils.aoa_to_sheet(values);
ws.H4.l = { Target:'https://example.invalid/proof' };
XLSX.utils.book_append_sheet(wb, ws, 'Oct 2026');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(values), 'Oct 2025');
const settings = {name:'My bank',outFrom:'2026-10-20'};
const rows = workbookSpend(wb, settings, '2026-10-31', 'synthetic-id');
assert.equal(rows.length,2);
assert.equal(workbookSpend(wb,{...settings,outFrom:'2026-07-01',sheetFrom:'2026-10-31'},'2026-10-31','synthetic-id').length,0,
 'explicit Sheet start overrides old fiscal cutoff and excludes earlier payments');
assert.equal(rows[0].amount,'200.00', 'Amount Sent, never Amount Received or allocation columns');
assert.equal(rows[0].details[7].link,'https://example.invalid/proof');
assert.equal(rows[0].details[12].value,'Delivery bill paid separately');
assert.equal(rows[0].sheet,'Oct 2026');
assert.match(decodeURIComponent(rows[0].rowUrl), /'Oct 2026'!A4/);
assert.notEqual(rows[0].key,rows[1].key,'identical amounts on separate rows remain separate');
assert.throws(()=>workbookSpend(wb,{outFrom:'2026-10-20'},'2026-10-31','test'),/Bank Name/i);
assert.throws(()=>workbookSpend(wb,{name:'Wrong name',outFrom:'2026-10-20'},'2026-10-31','test'),/No Sender Bank Account matches/);
XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([values[0],values[1],
  ['01/11/2026','Other bank','New receiver','',50,0,'My bank','NOV-1']]),'Nov 2026');
assert.equal(workbookSpend(wb,settings,'2026-11-30','synthetic-id').filter(r=>r.sheet==='Nov 2026').length,1,
  'a new monthly tab is discovered without adding its name to the code');
console.log('Banking Sheets checks passed: sender match, Amount Sent, cutoff, monthly tabs, separate rows, all details and proof links.');
