import { readFileSync } from 'node:fs';
import { pool } from './db.js';
export async function initBankingSheetSettings(){
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:004_banking_sheet_start'))");
    const r=await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='banks' AND column_name='sheet_from'");
    if(!r.rows.length)await c.query(readFileSync(new URL('./migrations/004_banking_sheet_start.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export function sheetStart(value){
  if(!value)return null;
  if(!/^20\d\d-\d\d-\d\d$/.test(String(value))||Number.isNaN(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)
    throw new Error('Select a valid Sheet start date');
  return value;
}
