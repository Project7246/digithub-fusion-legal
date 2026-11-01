import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { addMoney, money } from './banking-money.js';

export async function initBankingSetup() {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:002_banking_openings'))");
    const r=await c.query("SELECT to_regclass('public.banking_setups') AS applied");
    if(!r.rows[0]?.applied) await c.query(readFileSync(new URL('./migrations/002_banking_openings.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');
  } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
}
export async function bankingSetups(realmId, year) {
  const r=await pool.query(`SELECT DISTINCT ON (bank_id) id,bank_id,fiscal_year,opening_in,opening_out,
    to_char(in_from,'YYYY-MM-DD') AS in_from,to_char(out_from,'YYYY-MM-DD') AS out_from
    FROM banking_setups WHERE realm_id=$1 AND fiscal_year=$2 ORDER BY bank_id,id DESC`,[realmId,year]);
  return r.rows.map(s=>({setupId:s.id,bankId:Number(s.bank_id),fiscalYear:s.fiscal_year,openingIn:s.opening_in,
    openingOut:s.opening_out,inFrom:s.in_from,outFrom:s.out_from}));
}
function day(s) {
  if(!/^20\d\d-\d\d-\d\d$/.test(String(s))) throw new Error('Select a valid start date');
  if(new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s) throw new Error('Select a valid start date');
  return s;
}
export async function saveBankingSetup(realmId,input,actor,transaction=null) {
  const fiscalYear=Number(input.fiscalYear),bankId=Number(input.bankId);
  if(!Number.isSafeInteger(fiscalYear)||fiscalYear<2001||fiscalYear>2100||!Number.isSafeInteger(bankId)||bankId<=0)
    throw new Error('Select a bank and fiscal year');
  const inFrom=day(input.inFrom),outFrom=day(input.outFrom);
  for(const on of [inFrom,outFrom]) if(on<`${fiscalYear-1}-07-01`||on>`${fiscalYear}-06-30`)
    throw new Error('Start dates must be in the selected fiscal year');
  for(const field of ['openingIn','openingOut']) if(input[field]==null||String(input[field]).trim()===''||money(input[field])<0n)
    throw new Error('Enter non-negative Opening In and Opening Out; use 0 for none');
  const c=transaction || await pool.connect();
  try {
    if(!transaction)await c.query('BEGIN');
    await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const b=await c.query("SELECT id,opening,opening_on,sheet_url,to_char(sheet_from,'YYYY-MM-DD') AS sheet_day,to_char(opening_balance_on,'YYYY-MM-DD') AS balance_day FROM banks WHERE realm_id=$1 AND id=$2 FOR UPDATE",[realmId,bankId]);
    if(!b.rows.length) throw new Error('No such bank in this company');
    if(input.expectedId) {
      const latest=await c.query('SELECT id FROM banking_setups WHERE realm_id=$1 AND bank_id=$2 AND fiscal_year=$3 ORDER BY id DESC LIMIT 1',
        [realmId,bankId,fiscalYear]);
      if(String(latest.rows[0]?.id)!==String(input.expectedId))throw new Error('Fiscal opening changed; refresh before correcting it');
    }
    if(Object.hasOwn(input,'openingBalance')){
      const hasBalance=String(input.openingBalance??'').trim()!=='';
      const opening=hasBalance?addMoney([input.openingBalance]):null;
      let balanceOn=null;
      if(hasBalance){try{balanceOn=day(input.openingBalanceOn);}catch{throw new Error('Select a valid opening balance date');}}
      await c.query('UPDATE banks SET opening=$3,opening_balance_on=$4 WHERE realm_id=$1 AND id=$2',[realmId,bankId,opening,balanceOn]);
      await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
        [realmId,actor,'bank-opening',JSON.stringify([{bankId,before:{opening:b.rows[0].opening,opening_balance_on:b.rows[0].balance_day},
          after:{opening,opening_balance_on:balanceOn}}])]);
    }
    if(Object.hasOwn(input,'openingBalance')){
      await c.query('UPDATE banks SET sheet_from=$3 WHERE realm_id=$1 AND id=$2',[realmId,bankId,outFrom]);
      if(b.rows[0].sheet_day!==outFrom)await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
        [realmId,actor,'bank-sheet',JSON.stringify([{bankId,before:{sheet_url:b.rows[0].sheet_url,sheet_from:b.rows[0].sheet_day},after:{sheet_url:b.rows[0].sheet_url,sheet_from:outFrom}}])]);
    }
    const saved=await c.query(`INSERT INTO banking_setups (realm_id,bank_id,fiscal_year,opening_in,opening_out,
      in_from,out_from,actor,previous_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT id FROM banking_setups
        WHERE realm_id=$1 AND bank_id=$2 AND fiscal_year=$3 ORDER BY id DESC LIMIT 1)) RETURNING id`,
      [realmId,bankId,fiscalYear,addMoney([input.openingIn]),addMoney([input.openingOut]),inFrom,outFrom,
        actor]);
    await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realmId,actor,'save-setup',JSON.stringify([{setupId:saved.rows[0].id}])]);
    if(!transaction)await c.query('COMMIT');
    return saved.rows[0].id;
  } catch(e) {if(!transaction)await c.query('ROLLBACK');throw e;} finally {if(!transaction)c.release();}
}
export async function recordBankEntry(realmId,input,actor,transaction=null) {
  const on=day(input.on),value=addMoney([input.amount]);
  if(money(value)<=0n) throw new Error('Enter an amount greater than zero');
  if(!['in','out','transfer'].includes(input.type)) throw new Error('Select Transaction In, Out or transfer');
  if(input.type!=='transfer'&&!String(input.note||'').trim()) throw new Error('Enter a reference or description');
  const ids=input.type==='transfer'?[Number(input.fromBank),Number(input.toBank)]:[Number(input.bankId)];
  if(ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length) throw new Error('Select different valid banks');
  const c=transaction || await pool.connect();
  try {
    if(!transaction)await c.query('BEGIN');
    await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const owned=await c.query('SELECT id FROM banks WHERE realm_id=$1 AND id=ANY($2::int[]) FOR UPDATE',[realmId,ids]);
    if(owned.rows.length!==ids.length) throw new Error('No such bank in this company');
    const amounts=input.type==='transfer'?['-'+value,value]:[input.type==='out'?'-'+value:value];
    const entries=[];
    for(let i=0;i<ids.length;i++) {
      const r=await c.query(`INSERT INTO bank_moves (realm_id,bank_id,on_date,amount,kind,source,other_bank_id,note,made_by)
        VALUES ($1,$2,$3,$4,$5,'hand',$6,$7,$8) RETURNING id`,
        [realmId,ids[i],on,amounts[i],input.type==='transfer'?'transfer':'adjust',ids.length===2?ids[1-i]:null,String(input.note||'Bank transfer').trim(),actor]);
      entries.push({id:r.rows[0].id,bankId:ids[i],on,amount:amounts[i]});
    }
    await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realmId,actor,input.type,JSON.stringify(entries)]);
    if(!transaction)await c.query('COMMIT');return entries;
  } catch(e) {if(!transaction)await c.query('ROLLBACK');throw e;} finally {if(!transaction)c.release();}
}
