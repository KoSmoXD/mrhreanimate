'use strict';
const crypto=require('node:crypto');
const {createKey}=require('./scripts/create-plus-key');
module.exports=function setupPro(app,{db,auth,rateLimit}){
 db.exec(`CREATE TABLE IF NOT EXISTS pro_access(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER,activated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pro_keys(key_hash TEXT PRIMARY KEY,duration_ms INTEGER,created_at INTEGER NOT NULL,redeemed_at INTEGER,redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL);`);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const accessLookup=db.prepare('SELECT expires_at FROM pro_access WHERE user_id=?');
 const isKeyGenerator=user=>!!user&&user.role==='owner'&&user.username==='Mr_H';
 const hasPlus=(id,role)=>{if(role==='owner')return true;if(!id)return false;const row=accessLookup.get(id);return !!row&&(row.expires_at===null||row.expires_at>Date.now());};
 function status(req){const access=req.user?accessLookup.get(req.user.id):null;return {required:true,loggedIn:!!req.user,isOwner:req.user?.role==='owner',isKeyGenerator:isKeyGenerator(req.user),hasAccess:!!req.user&&hasPlus(req.user.id,req.user.role),expiresAt:access?.expires_at??null};}
 const requirePro=(req,res,next)=>status(req).hasAccess?next():res.status(403).json({error:'+ access required. Redeem an access key to generate AI animations.'});
 const limiter=rateLimit({windowMs:15*60000,limit:12,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/pro/status',(req,res)=>res.set('Cache-Control','no-store').json(status(req)));
 const generatorLimit=rateLimit({windowMs:60*60000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Key generation limit reached. Try again later.'}});
 // Only the authenticated, reserved Mr_H owner can issue keys. No client-provided role is trusted.
 app.post('/api/pro/keys',auth,(req,res,next)=>isKeyGenerator(req.user)?next():res.status(403).json({error:'Only Mr_H can generate PLUS keys.'}),generatorLimit,(req,res)=>{
  const {count,lifetime}=req.body||{};
  if(!Number.isInteger(count)||count<1||count>10||typeof lifetime!=='boolean')
   return res.status(400).json({error:'Choose 1–10 keys and a valid duration, or lifetime.'});
  const units={days:86400000,hours:3600000,minutes:60000,seconds:1000};
  const limits={days:3650,hours:23,minutes:59,seconds:59};
  let durationMs=null;
  const parts={};
  if(lifetime){
   // Zeroes/nulls are allowed for legacy clients, but nonzero durations are not.
   if(Object.keys(units).some(u=>req.body?.[u]!=null&&req.body[u]!==0))
    return res.status(400).json({error:'Lifetime keys do not take a duration.'});
  }else{
   for(const unit of Object.keys(units)){
    const value=req.body?.[unit]??0;
    if(!Number.isInteger(value)||value<0||value>limits[unit])
     return res.status(400).json({error:'Duration must use 0–3650 days, 0–23 hours, 0–59 minutes and 0–59 seconds.'});
    parts[unit]=value;
   }
   durationMs=Object.keys(units).reduce((sum,unit)=>sum+parts[unit]*units[unit],0);
   if(durationMs<1000||durationMs>3650*86400000)
    return res.status(400).json({error:'Choose a duration between 1 second and 3650 days.'});
  }
  try{
   const keys=db.transaction(()=>Array.from({length:count},()=>createKey(db,{lifetime,durationMs})))();
   res.set('Cache-Control','no-store').json({keys,count:keys.length,lifetime,...(lifetime?{days:null,hours:null,minutes:null,seconds:null}:parts)});
  }catch(error){console.error('PLUS key generation failed:',error.message);res.status(500).json({error:'Could not generate keys.'});}
 });
 app.post('/api/pro/redeem',auth,limiter,(req,res)=>{
  const key=typeof req.body?.key==='string'?req.body.key.trim().toUpperCase():'';
  if(!/^(?:PLUS|PRO)-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(key))return res.status(400).json({error:'Enter a valid + access key.'});
  const redeemed=db.transaction(()=>{const item=db.prepare('SELECT * FROM pro_keys WHERE key_hash=?').get(hash(key));if(!item||item.redeemed_at!==null)return false;
   const now=Date.now(),existing=db.prepare('SELECT expires_at FROM pro_access WHERE user_id=?').get(req.user.id);
   const expires=item.duration_ms===null||existing?.expires_at===null?null:Math.max(now,existing?.expires_at||0)+item.duration_ms;
   db.prepare('INSERT INTO pro_access(user_id,expires_at,activated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at').run(req.user.id,expires,now);
   db.prepare('UPDATE pro_keys SET redeemed_at=?,redeemed_by=? WHERE key_hash=?').run(now,req.user.id,hash(key));return true;
  })();
  if(!redeemed)return res.status(400).json({error:'Key is invalid or already redeemed.'});
  res.set('Cache-Control','no-store').json(status(req));
 });
 return {requirePro,proStatus:status,hasPlus};
};
