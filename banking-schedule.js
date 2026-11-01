// Banking retention only. Existing Logistics ingestion/scheduling stays unchanged.
import { pool, getCompany } from './db.js';
import { bankingReceipts } from './couriers.js';
import { retainCovers, archiveCandidates, deferArchive, archiveReady } from './banking-archive.js';
import { receiptDetail } from './banking-cprs.js';
import { mayRun, beginBackground, endBackground } from './compute.js';

// Pakistan is UTC+05:00: 15:00 and 22:00 are 10:00 and 17:00 UTC.
export function scheduleSlot(date=new Date()){
  const midnight=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
  const slots=[midnight-7*3600000,midnight+10*3600000,midnight+17*3600000,midnight+34*3600000];
  return {due:new Date(slots.filter(t=>t<=date.getTime()).at(-1)).toISOString(),
    next:new Date(slots.find(t=>t>date.getTime())).toISOString()};
}

// Reuse append-only Banking audit for durable slot claims, not a new DB poller.
async function event(realm,slot,value,c=pool){
  await c.query('INSERT INTO banking_entry_audit (realm_id,actor,action,new_value) VALUES ($1,$2,$3,$4::jsonb)',
    [realm,'banking:scheduler','archive-schedule',JSON.stringify({slot,...value})]);
}
export async function claimArchiveSlot(realm,slot){
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['banking:archive:'+realm]);
    const old=await c.query(`SELECT new_value,created_at FROM banking_entry_audit
      WHERE realm_id=$1 AND action='archive-schedule' AND new_value->>'slot'=$2 ORDER BY id DESC LIMIT 1`,[realm,slot]);
    const last=old.rows[0];
    if(last&&(last.new_value.state==='finished'||Date.now()-new Date(last.created_at).getTime()<3600000)){
      await c.query('COMMIT');return false;
    }
    await event(realm,slot,{state:'started'},c);await c.query('COMMIT');return true;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function finish(realm,slot,value){
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
    await event(realm,slot,value,c);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
const defaults={now:Date.now,allowed:()=>mayRun().ok,
  realms:async()=> (await pool.query('SELECT DISTINCT realm_id FROM banks WHERE active IS NOT FALSE ORDER BY realm_id')).rows.map(r=>r.realm_id),
  company:async realm=>!!await getCompany(realm),claim:claimArchiveSlot,covers:bankingReceipts,retain:retainCovers,
  candidates:archiveCandidates,detail:receiptDetail,defer:deferArchive,finish,begin:beginBackground,end:endBackground};

export async function runArchiveSlot(slot,deps=defaults){
  if(!deps.allowed())return;
  const mark=deps.begin(),until=deps.now()+180000;
  try{
    const realms=await deps.realms();
    // Rotate first company across runs so a busy installation shares its time cap.
    const offset=realms.length?Math.floor(new Date(slot).getTime()/3600000)%realms.length:0;
    const ordered=Number.isFinite(offset)?[...realms.slice(offset),...realms.slice(0,offset)]:realms;
    for(const realm of ordered){
      if(!deps.allowed()||deps.now()>=until)break;
      if(!await deps.company(realm)||!await deps.claim(realm,slot))continue;
      let details=0,errors=0,covers=0;
      try{
        const readAt=new Date().toISOString(),rows=await deps.covers(realm);covers=rows.length;
        await deps.retain(realm,rows,readAt);
        while(details<20&&deps.allowed()&&deps.now()<until){
          const candidates=await deps.candidates(realm);if(!candidates.length)break;
          for(const row of candidates){
            if(details>=20||!deps.allowed()||deps.now()>=until)break;
            try{const result=await deps.detail(realm,row.account_id,row.cpr_number);if(result?.warning)errors++;}
            catch{errors++;}
            finally{details++;await deps.defer(realm,row.account_id,row.cpr_number);}
          }
        }
        await deps.finish(realm,slot,{state:'finished',covers,details,errors});
      }catch{
        await deps.finish(realm,slot,{state:'failed',covers,details,errors:errors+1});
      }
    }
  }finally{deps.end(mark);}
}

let timer=null,running=false;
export function startBankingSchedule(){
  if(timer)return;
  const tick=async()=>{
    try{
      if(!running&&archiveReady()){
        running=true;
        try{await runArchiveSlot(scheduleSlot().due);}finally{running=false;}
      }
    }catch{console.error('Banking scheduled archive run failed; next daily slot will retry');}
    finally{
      const next=new Date(scheduleSlot().next).getTime();
      timer=setTimeout(tick,Math.max(1000,next-Date.now()));timer.unref();
    }
  };
  // Restart catch-up checks only the latest due slot; never replay an old backlog.
  timer=setTimeout(tick,15000);timer.unref();
}
