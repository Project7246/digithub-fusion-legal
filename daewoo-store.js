import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { saveOrders } from './couriers.js';
import { groupFor } from './adapters.js';
import { mapDaewooOrders } from './daewoo-map.js';
export const daewooOrders=(rows,details=[])=>mapDaewooOrders(rows,status=>groupFor('daewoo',status),details);

export async function initDaewooReports(database=pool){
  const c=await database.connect();
  try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:007_daewoo_source_reports'))");
    const found=await c.query("SELECT to_regclass('public.daewoo_source_reports') AS applied");
    if(!found.rows[0]?.applied)await c.query(readFileSync(new URL('./migrations/007_daewoo_source_reports.sql',import.meta.url),'utf8'));
    await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export async function saveDaewooBundle({realmId,accountId,customerId,from,to,orders,covers,details=[]},database=pool){
  if(!realmId||!accountId||!customerId||!Array.isArray(orders)||!Array.isArray(covers)||!Array.isArray(details))throw new Error('Daewoo source bundle incomplete');
  const mapped=daewooOrders(orders,details),c=await database.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['daewoo-sync:'+realmId+':'+accountId]);
    const saved=await saveOrders(realmId,accountId,'daewoo',mapped,c);
    const docs=[];
    for(const row of covers){
      const ref=String(row.invoice_no||'').trim();if(!ref)throw new Error('Daewoo COD invoice reference missing');
      docs.push({kind:'cod-cpr',ref,payload:row});
    }
    for(const row of details){
      const invoice=String(row.invoice_no||'').trim(),booking=String(row.booking_id||row.BarCode||'').trim();
      if(!invoice||!booking)throw new Error('Daewoo invoice detail identity missing');
      docs.push({kind:'cod-cpr-detail',ref:invoice+'|'+booking,payload:row});
      if(row.RST_Amt!=null||row.RWHT_Amt!=null)docs.push({kind:'tax',ref:invoice+'|'+booking,payload:row});
      if(row.amount_wr!=null)docs.push({kind:'delivery-charge',ref:invoice+'|'+booking,payload:row});
    }
    for(const row of orders){
      const booking=String(row.booking_id||row.BarCode||'');
      if(row.Service_invoice_no)docs.push({kind:'delivery-charge',ref:String(row.Service_invoice_no)+'|'+booking,payload:row});
      if(row.Payment_invoice_no&&row.AmountPaid2!=null)docs.push({kind:'payment-report',ref:String(row.Payment_invoice_no)+'|'+booking,payload:row});
      if(row.RST_Amt!=null||row.RWHT_Amt!=null)docs.push({kind:'tax',ref:booking+'|'+String(row.Payment_invoice_no||row.invoice_no||'unlinked'),payload:row});
    }
    for(const doc of docs)await c.query(`INSERT INTO daewoo_source_reports
      (realm_id,account_id,customer_id,report_kind,source_ref,period_start,period_end,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      ON CONFLICT(realm_id,account_id,customer_id,report_kind,source_ref) DO UPDATE SET
        period_start=EXCLUDED.period_start,period_end=EXCLUDED.period_end,payload=EXCLUDED.payload,synced_at=NOW()`,
      [realmId,accountId,customerId,doc.kind,doc.ref,from,to,JSON.stringify(doc.payload)]);
    await c.query('COMMIT');return {orders:saved,documents:docs.length};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

export async function readDaewooBundle({realmId,accountId,from,to},database=pool){
  const c=await database.connect();
  try{
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.realm_id',$1,true)",[realmId]);
    const [orders,documents]=await Promise.all([
      c.query(`SELECT tracking,order_ref,status,status_group,amount,fee,tax,city,booked_on,picked_on,delivered_on,raw
        FROM courier_orders WHERE realm_id=$1 AND account_id=$2 AND courier='daewoo'
        AND booked_on >= $3::date AND booked_on < ($4::date + INTERVAL '1 day') ORDER BY booked_on,tracking`,[realmId,accountId,from,to]),
      c.query(`SELECT customer_id,report_kind,source_ref,payload,period_start,period_end,synced_at FROM daewoo_source_reports
        WHERE realm_id=$1 AND account_id=$2 AND period_start <= $4::date AND period_end >= $3::date
        ORDER BY period_start,report_kind,source_ref`,[realmId,accountId,from,to])
    ]);
    const result={orders:orders.rows.map(r=>({booking_id:r.tracking,BarCode:r.tracking,reference_no:r.order_ref,status:r.status,
      fusionStatusGroup:r.status_group,amount_cod:r.amount,amount_wr:r.fee,DestinationTerminal:r.city,booking_datetime_f:r.booked_on,
      ...r.raw?.original})),covers:documents.rows.filter(r=>r.report_kind==='cod-cpr').map(r=>r.payload),
      sourceReports:documents.rows.map(r=>({kind:r.report_kind,reference:r.source_ref,payload:r.payload,from:r.period_start,to:r.period_end,syncedAt:r.synced_at})),
      customerId:documents.rows[0]?.customer_id||null,readAt:documents.rows[0]?.synced_at||null};
    await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK');throw error;
  }finally{c.release();}
}
