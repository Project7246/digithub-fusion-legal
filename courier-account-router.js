import { Router } from 'express';
import { pool } from './db.js';

export function createCourierAccountRouter({requireAdmin,database=pool}){
  const router=Router();
  router.post('/rename',async(req,res)=>{
    const realm=await requireAdmin(req,res);if(!realm)return;
    const id=String(req.body.id??''),label=String(req.body.label??'').trim();
    if(!/^[1-9]\d*$/.test(id)||!label||label.length>120||/[\x00-\x1f]/.test(label))return res.status(400).json({error:'Enter an account name (1–120 characters).'});
    try{
      const result=await database.query('UPDATE courier_accounts SET label=$3 WHERE realm_id=$1 AND id=$2 RETURNING id,label',[realm,id,label]);
      if(!result.rows.length)return res.status(404).json({error:'Account not found in this company.'});
      res.json({ok:true,account:result.rows[0]});
    }catch(e){res.status(e.code==='23505'?409:500).json({error:e.code==='23505'?'That courier already has an account with this name.':'Could not save the account name.'});}
  });
  return router;
}
