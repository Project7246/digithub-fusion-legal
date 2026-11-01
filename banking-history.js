import XLSX from 'xlsx';
import { pool } from './db.js';
import { money, addMoney } from './banking-money.js';
import { recordBankEntry, saveBankingSetup } from './banking-setup.js';

export function columnBreakdown(report, bankId, column) {
  const bank=report.banks.find(b=>b.id===Number(bankId));
  if(!bank || !['opening','inYear','outYear'].includes(column)) throw new Error('Select a bank and money column');
  if(column==='opening') return {bank,column,total:bank.opening,rows:[{
    on:bank.openingBalanceOn,amount:bank.opening,note:'Opening bank balance',source:'opening'}]};
  const incoming=column==='inYear';
  const rows=report.moves.filter(m=>m.bankId===bank.id && m.affectsBalance!==false &&
    m.on>=report.year.from && m.on<=report.year.to && m.amount!=null &&
    (incoming?money(m.amount)>0n:money(m.amount)<0n)).map(m=>({...m,
      amount:incoming?addMoney([m.amount]):addMoney([String(m.amount).replace(/^-/,'')])}));
  if(bank.fiscalYear===report.year.year) rows.unshift({on:incoming?bank.inFrom:bank.outFrom,
    amount:incoming?bank.openingIn:bank.openingOut,note:incoming?'Historical Opening In':'Historical Opening Out',source:'fiscal opening'});
  const total=(incoming?(bank.incomeIncomplete ?? bank.balanceIncomplete):bank.expenseIncomplete)?null:bank[column];
  return {bank,column,total,rows,warning:total==null?'Source data unavailable; rows below are the available entries':
    addMoney(rows.map(r=>r.amount))!==addMoney([bank[column]])?'Source total differs; refresh the report':''};
}

export function paymentWorkbook(rows) {
  const value=(r,i)=>r.details?.[i]?.value || '';
  const data=[['Month','Date','Receiver','Amount sent','Sender bank','Receiver bank','Account head','Combined narration / remarks','Reference','Source row'],
    ...rows.map(r=>[r.on.slice(0,7),r.on,value(r,2)||r.note,Number(String(r.amount).replace(/^-/,'')),
      value(r,6),value(r,1),value(r,13),value(r,15)||value(r,12)||r.note,value(r,7),r.rowUrl||''])];
  data.push(['Total','','',Number(addMoney(rows.map(r=>String(r.amount).replace(/^-/,''))))]);
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[12,14,28,18,30,24,28,65,26,40].map(wch=>({wch}));
  rows.forEach((r,i)=>{
    for(const [col,url] of [[8,r.details?.[7]?.link],[9,r.rowUrl]]) if(/^https?:\/\//i.test(url||''))
      ws[XLSX.utils.encode_cell({r:i+1,c:col})].l={Target:url};
  });
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Payments');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}

export function historyWorkbook(history,kind,banks=[]) {
  const bank=id=>{const b=banks.find(b=>b.id===Number(id));return b?(b.title||b.name):'Bank '+id;};
  const number=v=>v==null?'':Number(v);
  let rows;
  if(kind==='setup') rows=[['Record','Bank','Fiscal year','Opening In','Opening Out','In start','Out start','Status','Saved by','Saved at'],
    ...(history.setups||[]).map(r=>[r.id,bank(r.bankId),r.fiscalYear,number(r.openingIn),number(r.openingOut),r.inFrom,r.outFrom,r.active?'Current':'Superseded',r.actor,r.createdAt])];
  else if(kind==='opening') rows=[['Record','Bank','Previous opening','New opening','Opening date','Saved by','Saved at'],
    ...(history.openings||[]).map(r=>[r.id,bank(r.bankId),number(r.before?.opening),number(r.after?.opening),r.after?.opening_balance_on||'',r.actor,r.createdAt])];
  else if(kind==='entry'||kind==='transfer') rows=[['Entry','Type','Date','Bank','Direction','Amount','Reference / note','Status','Saved by','Saved at'],
    ...(history.transactions||[]).filter(r=>kind==='transfer'?r.type==='transfer':r.type!=='transfer').flatMap(r=>
      r.entries.map(e=>[r.id,r.type,e.on,bank(e.bankId),money(e.amount)<0n?'Out':'In',number(e.amount),e.note||'',r.reversed?'Updated':'Active',r.actor,r.createdAt]))];
  else throw new Error('Select a valid log');
  const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=rows[0].map(()=>({wch:24}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Banking log');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}

export function historyTransactions(audits,moves) {
  const byMove=new Map(moves.map(m=>[String(m.id),m]));
  const isEntry=a=>['in','out','transfer'].includes(a.action);
  const changes=new Map(audits.filter(a=>a.action.startsWith('reverse:')).map(a=>{
    // Legacy edits inserted a replacement in the same SQL transaction. Keep
    // PostgreSQL's exact timestamp text; JS Date truncates its microseconds.
    const replacement=a.transaction_time && audits.filter(next=>
      isEntry(next) && BigInt(next.id)>BigInt(a.id) && next.actor===a.actor &&
      next.transaction_time===a.transaction_time).sort((x,y)=>BigInt(x.id)<BigInt(y.id)?-1:1)[0];
    const operation=a.new_value[0]?.operation || (replacement?'edit':'remove');
    return [a.action.slice(8),{operation,replacementId:replacement && String(replacement.id)}];
  }));
  function removed(id,seen=new Set()) {
    const change=changes.get(String(id));
    if(!change || seen.has(String(id)))return false;
    if(change.operation==='remove')return true;
    seen.add(String(id));
    return !!change.replacementId && removed(change.replacementId,seen);
  }
  return audits.filter(a=>isEntry(a) && !removed(a.id)).map(a=>({
    id:a.id,type:a.action,actor:a.actor,createdAt:a.created_at,reversed:changes.has(String(a.id)),
    entries:a.new_value.map(e=>({...e,note:byMove.get(String(e.id))?.note||''}))}));
}

export function fiscalHistory(rows,audits) {
  const byId=new Map(rows.map(s=>[String(s.id),s])),hidden=new Set();
  const explicitSaves=new Set(audits.filter(a=>a.action==='save-setup').flatMap(a=>a.new_value.map(e=>String(e.setupId))));
  function hide(id){while(id && !hidden.has(String(id))){hidden.add(String(id));id=byId.get(String(id))?.previous_id;}}
  for(const a of audits.filter(a=>a.action==='remove-setup')) for(const e of a.new_value){hide(e.setupId);hide(e.clearedSetupId);}
  for(const a of audits.filter(a=>a.action==='move-setup'))for(const e of a.new_value)hidden.add(String(e.clearedSetupId));
  // Earlier Remove saved a zero reset with the original start dates, without
  // an action marker. Keep that clearing row and its earlier chain out of view.
  for(const s of rows){const p=byId.get(String(s.previous_id));
    if(p && !explicitSaves.has(String(s.id)) && money(s.opening_in)===0n && money(s.opening_out)===0n &&
      s.in_day===p.in_day && s.out_day===p.out_day)hide(s.id);
  }
  const latest=new Map();
  for(const s of rows){const key=s.bank_id+':'+s.fiscal_year;if(!latest.has(key))latest.set(key,String(s.id));}
  return rows.filter(s=>!hidden.has(String(s.id))).map(s=>{
    const key=s.bank_id+':'+s.fiscal_year,active=latest.get(key)===String(s.id);
    return {id:s.id,bankId:s.bank_id,bank:s.title||s.name,fiscalYear:s.fiscal_year,openingIn:s.opening_in,
      openingOut:s.opening_out,inFrom:s.in_day,outFrom:s.out_day,actor:s.actor,createdAt:s.created_at,active};
  });
}

export async function bankingHistory(realmId) {
  const [audits,setups,moves]=await Promise.all([
    pool.query('SELECT id,action,new_value,actor,created_at,created_at::text AS transaction_time FROM banking_entry_audit WHERE realm_id=$1 ORDER BY id DESC',[realmId]),
    pool.query(`SELECT s.*,b.name,b.title,to_char(in_from,'YYYY-MM-DD') AS in_day,
      to_char(out_from,'YYYY-MM-DD') AS out_day FROM banking_setups s JOIN banks b ON b.id=s.bank_id AND b.realm_id=s.realm_id
      WHERE s.realm_id=$1 ORDER BY s.id DESC`,[realmId]),
    pool.query(`SELECT id,bank_id,amount,to_char(on_date,'YYYY-MM-DD') AS on,note,kind,other_bank_id
      FROM bank_moves WHERE realm_id=$1 AND source='hand' ORDER BY id DESC`,[realmId])]);
  const transactions=historyTransactions(audits.rows,moves.rows);
  return {transactions,openings:audits.rows.filter(a=>a.action==='bank-opening').map(a=>({
    id:a.id,actor:a.actor,createdAt:a.created_at,...a.new_value[0]})),setups:fiscalHistory(setups.rows,audits.rows)};
}

export async function correctTransaction(realmId,id,replacement,actor) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const found=await c.query('SELECT id,action,new_value FROM banking_entry_audit WHERE realm_id=$1 AND id=$2 FOR UPDATE',[realmId,id]);
    const a=found.rows[0];if(!a||!['in','out','transfer'].includes(a.action))throw new Error('No editable entry in this company');
    const already=await c.query('SELECT id FROM banking_entry_audit WHERE realm_id=$1 AND action=$2',[realmId,'reverse:'+id]);
    if(already.rows.length)throw new Error('This entry was already reversed; refresh the log');
    const ids=a.new_value.map(e=>Number(e.id));
    const originals=await c.query(`SELECT id,bank_id,to_char(on_date,'YYYY-MM-DD') AS on,amount,kind,other_bank_id
      FROM bank_moves WHERE realm_id=$1 AND source='hand' AND id=ANY($2::int[]) FOR UPDATE`,[realmId,ids]);
    if(originals.rows.length!==ids.length)throw new Error('Original entry is incomplete; no correction was made');
    const reversals=[];
    for(const m of originals.rows) {
      const amount=addMoney([String(m.amount).startsWith('-')?String(m.amount).slice(1):'-'+m.amount]);
      const r=await c.query(`INSERT INTO bank_moves (realm_id,bank_id,on_date,amount,kind,source,other_bank_id,note,made_by)
        VALUES ($1,$2,$3,$4,$5,'hand',$6,$7,$8) RETURNING id`,
        [realmId,m.bank_id,m.on,amount,m.kind,m.other_bank_id,'Reversal of entry '+id,actor]);
      reversals.push({id:r.rows[0].id,reversesMoveId:m.id,bankId:m.bank_id,on:m.on,amount,
        operation:replacement?'edit':'remove'});
    }
    await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realmId,actor,'reverse:'+id,JSON.stringify(reversals)]);
    if(replacement)await recordBankEntry(realmId,replacement,actor,c);
    await c.query('COMMIT');
  } catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function removeFiscalSetup(realmId,id,actor) {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const r=await c.query("SELECT *,to_char(in_from,'YYYY-MM-DD') AS in_day,to_char(out_from,'YYYY-MM-DD') AS out_day FROM banking_setups WHERE realm_id=$1 AND id=$2",[realmId,id]);
    const s=r.rows[0];if(!s)throw new Error('No such fiscal opening');
    const clearedId=await saveBankingSetup(realmId,{bankId:s.bank_id,fiscalYear:s.fiscal_year,openingIn:'0.00',openingOut:'0.00',
      inFrom:s.in_day,outFrom:s.out_day,expectedId:id},actor,c);
    await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realmId,actor,'remove-setup',JSON.stringify([{setupId:id,clearedSetupId:clearedId}])]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

export async function moveFiscalSetup(realmId,input,actor) {
  const from=Number(input.sourceBankId),to=Number(input.bankId),year=Number(input.fiscalYear);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<=0||to<=0||from===to||!input.expectedId)
    throw new Error('Select the original record and a different bank');
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const owned=await c.query('SELECT id FROM banks WHERE realm_id=$1 AND id=ANY($2::int[]) ORDER BY id FOR UPDATE',[realmId,[from,to]]);
    if(owned.rows.length!==2)throw new Error('No such bank in this company');
    const found=await c.query(`SELECT *,to_char(in_from,'YYYY-MM-DD') AS in_day,to_char(out_from,'YYYY-MM-DD') AS out_day
      FROM banking_setups WHERE realm_id=$1 AND id=$2 AND bank_id=$3 AND fiscal_year=$4`,[realmId,input.expectedId,from,year]);
    const source=found.rows[0];if(!source)throw new Error('No matching original fiscal opening');
    const target=(await c.query('SELECT id,opening_in,opening_out FROM banking_setups WHERE realm_id=$1 AND bank_id=$2 AND fiscal_year=$3 ORDER BY id DESC LIMIT 1',[realmId,to,year])).rows[0];
    if(target&&(money(target.opening_in)!==0n||money(target.opening_out)!==0n))throw new Error('Selected bank already has fiscal amounts. Edit or remove those first; nothing was moved.');
    const cleared=await saveBankingSetup(realmId,{bankId:from,fiscalYear:year,openingIn:'0.00',openingOut:'0.00',
      inFrom:source.in_day,outFrom:source.out_day,expectedId:input.expectedId},actor,c);
    const saved=await saveBankingSetup(realmId,{...input,bankId:to,expectedId:target?.id},actor,c);
    await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realmId,actor,'move-setup',JSON.stringify([{fromBank:from,toBank:to,sourceSetupId:input.expectedId,clearedSetupId:cleared,newSetupId:saved}])]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
