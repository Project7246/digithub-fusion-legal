import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { saveCprs } from './couriers.js';
import { prepareDaewooLock,checkBankConfirmation,settlementCover } from './daewoo-locks.js';

export async function initDaewooLocks(){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:006_daewoo_settlements'))");
    const found=await c.query("SELECT to_regclass('public.daewoo_settlements') AS applied");
    if(!found.rows[0]?.applied)await c.query(readFileSync(new URL('./migrations/006_daewoo_settlements.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
const unpack=row=>({...row.snapshot,id:String(row.id),state:row.state,
  bankReceipt:row.bank_receipt,createdAt:row.created_at,updatedAt:row.updated_at});
export function createDaewooLockStore({database=pool,publish=saveCprs}={}){
  async function transaction(realm,account,work){
    const c=await database.connect();
    try{
      await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['daewoo:'+realm+':'+account]);
      const result=await work(c);await c.query('COMMIT');return result;
    }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  }
  async function audit(c,realm,id,actor,action,before,after){
    if(!actor)throw new Error('ACTOR_REQUIRED');
    await c.query('INSERT INTO daewoo_settlement_audit (realm_id,settlement_id,actor,action,old_value,new_value) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [realm,id,actor,action,before?JSON.stringify(before):null,JSON.stringify(after)]);
  }
  return {
    async list(realm,account){
      return transaction(realm,account,async c=>(await c.query(
        'SELECT * FROM daewoo_settlements WHERE realm_id=$1 AND account_id=$2 ORDER BY id DESC',[realm,account])).rows.map(unpack));
    },
    async lock(scope,covers,input,actor){
      return transaction(scope.realmId,scope.accountId,async c=>{
        const rows=(await c.query('SELECT * FROM daewoo_settlements WHERE realm_id=$1 AND account_id=$2 FOR UPDATE',[scope.realmId,scope.accountId])).rows;
        if(rows.some(r=>r.payment_ref===String(input.paymentRef||'').trim()))throw new Error('PAYMENT_REFERENCE_ALREADY_LOCKED');
        const value=prepareDaewooLock(scope,covers,input,rows.filter(r=>r.state!=='reversed').map(unpack));
        const inserted=(await c.query(`INSERT INTO daewoo_settlements (realm_id,account_id,customer_id,payment_ref,state,snapshot,created_by)
          VALUES ($1,$2,$3,$4,'locked',$5::jsonb,$6) RETURNING *`,
          [scope.realmId,scope.accountId,scope.customerId,value.paymentRef,JSON.stringify(value),actor])).rows[0];
        const result=unpack(inserted);
        await publish(scope.realmId,Number(scope.accountId),'daewoo',[settlementCover(result)],c);
        await audit(c,scope.realmId,result.id,actor,'lock',null,result);return result;
      });
    },
    async transition(realm,account,id,action,input,actor,today){
      return transaction(realm,account,async c=>{
        const row=(await c.query('SELECT * FROM daewoo_settlements WHERE realm_id=$1 AND account_id=$2 AND id=$3 FOR UPDATE',[realm,account,id])).rows[0];
        if(!row)throw new Error('LOCK_NOT_FOUND');
        const before=unpack(row);let state,bankReceipt=row.bank_receipt;
        if(action==='bank-receipt'){
          if(row.state!=='locked')throw new Error('LOCK_ALREADY_FINAL');
          bankReceipt=checkBankConfirmation(before,input,today);state='received';
        }else if(action==='reverse'){
          if(row.state==='reversed')throw new Error('LOCK_ALREADY_REVERSED');
          if(!String(input.reason||'').trim())throw new Error('REVERSAL_REASON_REQUIRED');state='reversed';
        }else throw new Error('INVALID_ACTION');
        const updated=(await c.query('UPDATE daewoo_settlements SET state=$4,bank_receipt=$5::jsonb,updated_at=NOW() WHERE realm_id=$1 AND account_id=$2 AND id=$3 RETURNING *',
          [realm,account,id,state,bankReceipt?JSON.stringify(bankReceipt):null])).rows[0];
        const after=unpack(updated);
        await publish(realm,account,'daewoo',[settlementCover(after)],c);
        await audit(c,realm,id,actor,action,before,{...after,...(action==='reverse'?{reason:String(input.reason).trim().slice(0,500)}:{})});
        return after;
      });
    }
  };
}
