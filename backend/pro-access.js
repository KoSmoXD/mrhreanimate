'use strict';
const crypto=require('node:crypto');
module.exports=function setupPro(app,{db,auth,rateLimit}){
 db.exec(`CREATE TABLE IF NOT EXISTS pro_access(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER,activated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pro_keys(key_hash TEXT PRIMARY KEY,duration_ms INTEGER,created_at INTEGER NOT NULL,redeemed_at INTEGER,redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL);`);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 function status(req){const access=req.user?db.prepare('SELECT expires_at FROM pro_access WHERE user_id=?').get(req.user.id):null;return {required:true,loggedIn:!!req.user,isOwner:req.user?.role==='owner',hasAccess:req.user?.role==='owner'||!!access&&(access.expires_at===null||access.expires_at>Date.now()),expiresAt:access?.expires_at??null};}
 const requirePro=(req,res,next)=>status(req).hasAccess?next():res.status(403).json({error:'+ access required. Redeem an access key to generate AI animations.'});
 const limiter=rateLimit({windowMs:15*60000,limit:12,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/pro/status',(req,res)=>res.set('Cache-Control','no-store').json(status(req)));
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
 return {requirePro,proStatus:status};
};
