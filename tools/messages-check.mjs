// Synthetic SQL/session fixtures only. No production messages, DB or notifications.
import assert from 'node:assert/strict';
import express from 'express';
import { pool } from '../db.js';
import { sendMessage,messageText,createMessagesRouter } from '../messages.js';
import { readFileSync } from 'node:fs';
assert.equal(messageText(' hello '),'hello');assert.throws(()=>messageText(' '));assert.throws(()=>messageText('x'.repeat(4001)));
const migration=readFileSync(new URL('../migrations/005_internal_messages.sql',import.meta.url),'utf8');
assert.match(migration,/ENABLE ROW LEVEL SECURITY/);assert.match(migration,/UNIQUE\(realm_id,sender_sub,client_key\)/);
const originalQuery=pool.query,originalConnect=pool.connect;let calls=[],keys=new Set(),notifyFail=false,server;
pool.query=async(sql,args)=>{calls.push({sql,args});
 if(sql.includes('JOIN user_companies')){assert.equal(args[0],'A');return {rows:[{sub:'alice',name:'Alice Khan'},{sub:'bob',name:'Umer Ahmed'}]};}
 if(sql.includes('SELECT * FROM users'))return {rows:[{sub:'alice',name:'Alice Khan'}]};
 if(sql.includes('FROM team_messages')){assert.equal(args[0],'A');assert.equal(args[1],'alice');return {rows:[]};}
 if(sql.includes('UPDATE team_messages'))return {rows:[]};throw Error('Unexpected query');};
pool.connect=async()=>({release(){},async query(sql,args=[]){calls.push({sql,args});
 if(sql.includes('INSERT INTO team_messages')){const key=args[5];if(keys.has(key))return {rows:[]};keys.add(key);return {rows:[{id:'1',created_at:'2026-11-02'}]};}
 if(sql.includes('INSERT INTO notifications')&&notifyFail)throw Error('notification failed');return {rows:[]};}});
try{
 await sendMessage('A','alice','bob','Hello','synthetic-key-0001');
 assert.equal(calls.at(-1).sql,'COMMIT');
 const insert=calls.find(c=>c.sql.includes('INSERT INTO team_messages'));assert.deepEqual(insert.args.slice(0,5),['A','alice','bob','Alice Khan','Hello']);
 const notification=calls.find(c=>c.sql.includes('INSERT INTO notifications'));assert.equal(notification.args[0],'bob');assert.equal(notification.args[2],'Alice Khan');
 calls=[];await sendMessage('A','alice','bob','Hello','synthetic-key-0001');assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO notifications')),'retry cannot duplicate message notification');
 calls=[];await assert.rejects(sendMessage('A','alice','other-company','Private','synthetic-key-0002'),/authorized user/);
 assert.ok(!calls.some(c=>c.sql.includes('INSERT')));
 notifyFail=true;calls=[];await assert.rejects(sendMessage('A','alice','bob','Fail','synthetic-key-0003'),/notification failed/);assert.equal(calls.at(-1).sql,'ROLLBACK');notifyFail=false;
 const app=express();app.use(express.json());app.use('/api/messages',createMessagesRouter({currentUser:r=>r.headers['x-user'],requireCompany:async()=> 'A'}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url='http://127.0.0.1:'+server.address().port+'/api/messages/';
 assert.equal((await fetch(url+'inbox')).status,401);
 const headers={'x-user':'alice','Content-Type':'application/json'};
 assert.equal((await fetch(url+'thread?with=other-company',{headers})).status,403);
 calls=[];await fetch(url+'thread?with=bob',{headers});assert.ok(calls.some(c=>c.sql.includes('LIMIT 50')&&c.args[1]==='alice'&&c.args[2]==='bob'));
 calls=[];await fetch(url+'read',{method:'POST',headers,body:JSON.stringify({with:'bob',through:'7',user:'victim'})});
 const read=calls.find(c=>c.sql.includes('UPDATE team_messages'));assert.deepEqual(read.args,['A','alice','bob','7']);assert.match(read.sql,/id<=\$4/);
}finally{pool.query=originalQuery;pool.connect=originalConnect;if(server)await new Promise(resolve=>server.close(resolve));}
console.log('Messages checks passed: company membership, session identity, private paired threads, pagination, bounded read acknowledgement, exact sender name, atomic notification rollback and duplicate-send protection.');
