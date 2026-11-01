// Read-only monthly Google workbook projection. No source rows are changed.
import XLSX from 'xlsx';
import { addMoney, money } from './banking-money.js';

const cache = new Map();
const pending = new Map();
export function googleSheetId(url) {
  try { const u = new URL(url); return u.hostname === 'docs.google.com' &&
    u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)\//)?.[1] || null; }
  catch { return null; }
}
const normal = v => String(v ?? '').trim().replace(/\s+/g,' ').toLowerCase();
function dateOf(c) {
  if (c?.t === 'n') { const d = XLSX.SSF.parse_date_code(c.v); return d &&
    `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`; }
  const s = String(c?.w ?? c?.v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null;
}
export function workbookSpend(wb, bank, today, id) {
  if (!normal(bank.name)) throw new Error('Bank Name is required for exact Sender Bank Account matching');
  const out = [];
  let sawSender=false, matchedSender=false;
  for (const name of wb.SheetNames) {
    // Only monthly bank books, never payables, inventory, courier or summary tabs.
    if (!/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}$/i.test(name.trim())) continue;
    const parts=name.trim().split(/\s+/);
    const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(parts[0].slice(0,3).toLowerCase())+1;
    const prefix=parts[1]+'-'+String(month).padStart(2,'0');
    const start=bank.outFrom||bank.openingOn;
    if(start && prefix<start.slice(0,7) || prefix>today.slice(0,7)) continue;
    const ws = wb.Sheets[name];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const cell = (r,c) => ws[XLSX.utils.encode_cell({r,c})];
    let header = -1, labels;
    for(let r=0;r<=Math.min(19,range.e.r);r++) {
      const row = Array.from({length:range.e.c+1},(_,c)=>String(cell(r,c)?.w ?? cell(r,c)?.v ?? ''));
      if(row.some(v=>normal(v)==='sender bank account') && row.some(v=>normal(v)==='amount sent')) {
        header=r;labels=row;break;
      }
    }
    if(header<0) throw new Error(name+': Sender Bank Account / Amount Sent headings missing');
    const col = label => labels.findIndex(v=>normal(v)===label);
    for(let r=header+1;r<=range.e.r;r++) {
      if(normal(cell(r,col('sender bank account'))?.v)) sawSender=true;
      if(normal(cell(r,col('sender bank account'))?.v)!==normal(bank.name)) continue;
      matchedSender=true;
      const day = dateOf(cell(r,col('date')));
      if(!day) throw new Error(name+': unreadable date at row '+(r+1));
      if(day>today || start && day<start) continue;
      const raw=cell(r,col('amount sent'));
      if(raw?.v == null || raw.v==='') continue;
      const amount=addMoney([String(raw.v).replace(/,/g,'')]);
      if(money(amount)<0n) throw new Error(name+': negative Amount Sent at row '+(r+1));
      if(money(amount)===0n) continue;
      const details=labels.map((label,c)=>({label:label||XLSX.utils.encode_col(c),
        value:String(cell(r,c)?.w ?? cell(r,c)?.v ?? ''), link:cell(r,c)?.l?.Target || null}));
      out.push({day,amount,note:String(cell(r,col('narration'))?.v || 'Sheet payment'),
        key:`sheet:${id}:${name}:${r+1}`,sheet:name,row:r+1,details,
        rowUrl:`https://docs.google.com/spreadsheets/d/${id}/edit#range=${encodeURIComponent("'"+name.replace(/'/g,"''")+"'!A"+(r+1))}`});
    }
  }
  if(sawSender && !matchedSender) throw new Error('No Sender Bank Account matches Bank Name "'+bank.name+'". Make the names identical; no other field is used.');
  return out;
}
export async function googleSpend(realmId, bank, today, fresh=false) {
  const id=googleSheetId(bank.sheetUrl);
  if(!id) throw new Error('A Google Sheet URL is required');
  const key=realmId+':'+id;
  const kept=cache.get(key);
  let wb=kept && !fresh && Date.now()-kept.at<60000 ? kept.wb : null;
  if(!wb) {
    if(!pending.has(key)) pending.set(key,(async()=>{
      const response=await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
        {signal:AbortSignal.timeout(20000)});
      if(!response.ok) throw new Error('Google Sheet export answered '+response.status);
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>12*1024*1024) throw new Error('Google Sheet export exceeds 12 MB');
      if(new Uint8Array(bytes)[0]!==80) throw new Error('Google Sheet export unavailable; check its existing sharing access');
      const result=XLSX.read(bytes,{type:'array'});
      cache.set(key,{wb:result,at:Date.now()});
      while(cache.size>20) cache.delete(cache.keys().next().value);
      return result;
    })());
    try { wb=await pending.get(key); } finally {pending.delete(key);}
  }
  return workbookSpend(wb,bank,today,id);
}
