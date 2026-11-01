import { readFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pool } from './db.js';
import { ORDER_FIELDS, SUMMARY_FIELDS } from './banking-workbook.js';

let ready=false;
export const archiveReady=()=>ready;
const coverFields=['accountId','cpr','courier','account','remoteId','status','net','gross','charges','tax','withholding',
  'orders','linkedOrders','createdOn','paidOn','paidToBank','paidToAccount','instrument','mode','bankFee'];
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
const cleanCover=r=>pick(r,coverFields);
const provided=r=>Object.fromEntries(Object.entries(r).filter(([,v])=>v!=null&&v!==''));
const key=r=>r.accountId+':'+r.cpr;
const financial=r=>pick(r,['net','gross','charges','tax','withholding','bankFee','status','paidOn']);

export async function initBankingArchive(){
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:003_banking_receipt_archive'))");
    const found=await c.query("SELECT to_regclass('public.banking_receipt_archive') AS applied");
    if(!found.rows[0]?.applied)await c.query(readFileSync(new URL('./migrations/003_banking_receipt_archive.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');ready=true;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export function mergeReceipts(saved,current){
  const combined=new Map(saved.map(r=>[key(r),{...r,archived:true}]));
  current.forEach(r=>combined.set(key(r),{...combined.get(key(r)),...provided(r),archived:false}));return [...combined.values()];
}
export async function savedReceipts(realm){
  const r=await pool.query('SELECT cover,detail_complete FROM banking_receipt_archive WHERE realm_id=$1',[realm]);
  return r.rows.map(x=>({...x.cover,archiveComplete:x.detail_complete}));
}
export async function retainCovers(realm,receipts,readAt=new Date().toISOString()){
  if(!receipts.length)return;
  const covers=[...new Map(receipts.map(r=>[key(r),cleanCover(r)])).values()];
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
    const before=await c.query('SELECT account_id,cpr_number,cover FROM banking_receipt_archive WHERE realm_id=$1 FOR UPDATE',[realm]);
    const old=new Map(before.rows.map(r=>[r.account_id+':'+r.cpr_number,r.cover]));
    covers.forEach((r,i)=>{covers[i]=cleanCover({...old.get(key(r)),...provided(r)});});
    const saved=await c.query(`INSERT INTO banking_receipt_archive AS a
      (realm_id,account_id,cpr_number,courier,net_amount,paid_on,cover,source_read_at)
      SELECT $1,(x->>'accountId')::int,x->>'cpr',x->>'courier',(x->>'net')::numeric,
        NULLIF(x->>'paidOn','')::date,x,$3::timestamptz FROM jsonb_array_elements($2::jsonb) x
      ON CONFLICT (realm_id,account_id,cpr_number) DO UPDATE SET cover=EXCLUDED.cover,
        courier=EXCLUDED.courier,net_amount=EXCLUDED.net_amount,paid_on=EXCLUDED.paid_on,
        source_read_at=EXCLUDED.source_read_at,updated_at=NOW(),
        detail_complete=FALSE,detail_next_try=NOW()
      WHERE EXCLUDED.source_read_at>=a.source_read_at AND a.cover IS DISTINCT FROM EXCLUDED.cover
      RETURNING account_id,cpr_number`,[realm,JSON.stringify(covers),readAt]);
    const changed=new Set(saved.rows.map(r=>r.account_id+':'+r.cpr_number));
    const audit=covers.filter(r=>changed.has(key(r))).map(r=>({accountId:r.accountId,cpr:r.cpr,
      before:old.has(key(r))?financial(old.get(key(r))):null,after:financial(r)}));
    if(audit.length)await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realm,'banking:retention','archive-cpr',JSON.stringify(audit)]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export function packDetail(detail){
  const value={version:1,receipt:cleanCover(detail.receipt),summary:pick(detail.summary,SUMMARY_FIELDS.map(f=>f[0])),
    orders:detail.orders.map(o=>pick(o,ORDER_FIELDS.map(f=>f[0]))),
    adjustments:(detail.adjustments||[]).map(a=>Object.fromEntries(Object.entries(a).filter(([k,v])=>
      !/password|secret|token|authorization/i.test(k)&&['string','number','boolean'].includes(typeof v)))),
    warning:detail.warning?'Partial saved detail; some courier information was unavailable when captured':''};
  const json=JSON.stringify(value);if(Buffer.byteLength(json)>20*1024*1024)throw new Error('CPR detail exceeds the Banking archive limit');
  const bytes=gzipSync(json,{level:6});return {bytes,hash:createHash('sha256').update(bytes).digest('hex')};
}
export const unpackDetail=bytes=>JSON.parse(gunzipSync(bytes,{maxOutputLength:20*1024*1024}).toString('utf8'));
export async function retainDetail(realm,detail,complete){
  const {bytes,hash}=packDetail(detail),r=detail.receipt,c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
    const saved=await c.query(`UPDATE banking_receipt_archive SET detail=$4,detail_hash=$5,detail_complete=$6,
      detail_orders=$7,detail_saved_at=NOW(),detail_next_try=NOW()+INTERVAL '6 hours'
      WHERE realm_id=$1 AND account_id=$2 AND cpr_number=$3
        AND ($6 OR NOT detail_complete) AND ($6 OR detail_orders<=$7)
        AND (detail_hash IS DISTINCT FROM $5 OR detail_complete IS DISTINCT FROM $6)
      RETURNING account_id`,[realm,r.accountId,r.cpr,bytes,hash,complete,detail.orders.length]);
    if(saved.rows.length)await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
      [realm,'banking:retention','archive-detail',JSON.stringify([{accountId:r.accountId,cpr:r.cpr,hash,orders:detail.orders.length,complete}])]);
    await c.query('COMMIT');return saved.rows.length>0;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function loadDetail(realm,account,cpr){
  const r=await pool.query(`SELECT detail,detail_saved_at,detail_complete FROM banking_receipt_archive
    WHERE realm_id=$1 AND account_id=$2 AND cpr_number=$3 AND detail IS NOT NULL`,[realm,Number(account),String(cpr)]);
  const row=r.rows[0];return row?{value:unpackDetail(row.detail),savedAt:row.detail_saved_at,complete:row.detail_complete}:null;
}
export async function archiveCandidates(realm){
  const r=await pool.query(`SELECT account_id,cpr_number FROM banking_receipt_archive
    WHERE realm_id=$1 AND NOT detail_complete AND detail_next_try<=NOW()
      ORDER BY paid_on DESC NULLS LAST LIMIT 2`,[realm]);
  return r.rows;
}
export async function deferArchive(realm,account,cpr){
  await pool.query(`UPDATE banking_receipt_archive SET detail_next_try=NOW()+INTERVAL '6 hours'
    WHERE realm_id=$1 AND account_id=$2 AND cpr_number=$3`,[realm,account,cpr]);
}

export async function* archiveCsv(realm){
  const fields=['accountId','account','courier','cpr','status','createdOn','paidOn','gross','charges','tax','withholding','bankFee','net','paidToBank','paidToAccount','instrument'];
  const numeric=new Set(['accountId','gross','charges','tax','withholding','bankFee','net']);
  const cell=(v,n)=>{let text=String(v??'');if(!n&&/^[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  yield '\uFEFF'+fields.join(',')+'\r\n';
  let account=0,cpr='';
  for(;;){
    const result=await pool.query(`SELECT account_id,cpr_number,cover FROM banking_receipt_archive
      WHERE realm_id=$1 AND (account_id,cpr_number)>($2::int,$3::text)
      ORDER BY account_id,cpr_number LIMIT 300`,[realm,account,cpr]);
    if(!result.rows.length)break;
    for(const row of result.rows)yield fields.map(f=>cell(row.cover[f],numeric.has(f))).join(',')+'\r\n';
    const last=result.rows.at(-1);account=last.account_id;cpr=last.cpr_number;
  }
}
