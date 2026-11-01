import express from 'express';
import { readFileSync } from 'node:fs';
import { pool } from './db.js';
import { messageUsers, getUser } from './users.js';
import { notify } from './notify.js';

export async function initMessages(){
 const c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('fusion:005_internal_messages'))");
  const found=await c.query("SELECT to_regclass('public.team_messages') AS applied");
  if(!found.rows[0]?.applied)await c.query(readFileSync(new URL('./migrations/005_internal_messages.sql',import.meta.url),'utf8'));
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export function messageText(value){
 const text=String(value??'').trim();if(!text||text.length>4000)throw new Error('Write a message of 1 to 4000 characters');return text;
}
export async function sendMessage(realm,sub,to,text,key){
 const body=messageText(text),people=await messageUsers(realm);
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(String(key||'')))throw new Error('Refresh messages before sending');
 if(to===sub||!people.some(u=>u.sub===to))throw new Error('Select an authorized user in this company');
 const sender=await getUser(sub);if(!sender)throw new Error('Sign in again');
 const name=String(sender.name||'User').trim(),c=await pool.connect();
 try{await c.query('BEGIN');await c.query("SELECT set_config('app.realm_id',$1,true)",[realm]);
  const row=await c.query(`INSERT INTO team_messages(realm_id,sender_sub,recipient_sub,sender_name,body,client_key)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(realm_id,sender_sub,client_key) DO NOTHING RETURNING id,created_at`,[realm,sub,to,name,body,key]);
  if(row.rows.length)await notify(to,{kind:'team-message',title:name,body:'New internal message',
    link:'/messages?with='+encodeURIComponent(sub)+'&company='+encodeURIComponent(realm)},c);
  await c.query('COMMIT');return row.rows[0];
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export function createMessagesRouter({requireCompany,currentUser}){
 const router=express.Router();
 router.use(async(req,res,next)=>{const sub=currentUser(req);if(!sub)return res.status(401).json({error:'Sign in first'});
  const realm=await requireCompany(req,res);if(!realm)return;req.messageRealm=realm;req.messageSub=sub;res.setHeader('Cache-Control','no-store');next();});
 router.get('/inbox',async(req,res)=>{try{
  const realm=req.messageRealm,sub=req.messageSub,people=await messageUsers(realm);
  const rows=await pool.query(`SELECT DISTINCT ON (peer) peer,body,created_at,id FROM (
    SELECT *,CASE WHEN sender_sub=$2 THEN recipient_sub ELSE sender_sub END AS peer FROM team_messages
    WHERE realm_id=$1 AND (sender_sub=$2 OR recipient_sub=$2)) t ORDER BY peer,id DESC`,[realm,sub]);
  const counts=await pool.query(`SELECT sender_sub,count(*)::int AS unread FROM team_messages
    WHERE realm_id=$1 AND recipient_sub=$2 AND read_at IS NULL GROUP BY sender_sub`,[realm,sub]);
  res.json({realm,me:sub,people:people.filter(p=>p.sub!==sub),threads:rows.rows,unread:counts.rows});
 }catch{res.status(500).json({error:'Could not read conversations'});}});
 router.get('/thread',async(req,res)=>{try{
  const realm=req.messageRealm,sub=req.messageSub,to=String(req.query.with||'');
  if(!(await messageUsers(realm)).some(u=>u.sub===to))return res.status(403).json({error:'User is unavailable in this company'});
  const before=/^\d+$/.test(String(req.query.before||''))?String(req.query.before):'9223372036854775807';
  const rows=await pool.query(`SELECT id,sender_sub,recipient_sub,sender_name,body,created_at,read_at FROM team_messages
    WHERE realm_id=$1 AND ((sender_sub=$2 AND recipient_sub=$3) OR (sender_sub=$3 AND recipient_sub=$2))
      AND id<$4::bigint ORDER BY id DESC LIMIT 50`,[realm,sub,to,before]);
  res.json({items:rows.rows.reverse(),more:rows.rows.length===50});
 }catch{res.status(500).json({error:'Could not read messages'});}});
 router.post('/send',async(req,res)=>{try{res.json({ok:true,...await sendMessage(req.messageRealm,req.messageSub,String(req.body.to||''),req.body.body,req.body.key)});}
  catch(e){res.status(400).json({error:e.message});}});
 router.post('/read',async(req,res)=>{try{
  const through=String(req.body.through||'');if(!/^\d+$/.test(through))throw Error('Select read messages');
  await pool.query(`UPDATE team_messages SET read_at=NOW() WHERE realm_id=$1 AND recipient_sub=$2 AND sender_sub=$3 AND id<=$4::bigint AND read_at IS NULL`,
    [req.messageRealm,req.messageSub,String(req.body.with||''),through]);res.json({ok:true});
 }catch{res.status(500).json({error:'Could not mark messages read'});}});
 return router;
}
