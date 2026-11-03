'use strict';
const crypto=require('node:crypto');
module.exports=function setupPro(app,{db,auth,rateLimit}){
 db.exec(`CREATE TABLE IF NOT EXISTS pro_access(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER,activated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS pro_keys(key_hash TEXT PRIMARY KEY,duration_ms INTEGER,created_at INTEGER NOT NULL,redeemed_at INTEGER,redeemed_by TEXT REFERENCES users(id) ON DELETE SET NULL);
 CREATE TABLE IF NOT EXISTS pro_purchases(roblox_user_id TEXT NOT NULL,pass_id TEXT NOT NULL,key_cipher TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(roblox_user_id,pass_id));`);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const create=duration=>{const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let text='';for(let i=0;i<15;i++)text+=alphabet[crypto.randomInt(alphabet.length)];const key='PRO-'+text.match(/.{5}/g).join('-');db.prepare('INSERT INTO pro_keys(key_hash,duration_ms,created_at) VALUES(?,?,?)').run(hash(key),duration,Date.now());return key};
 const purchaseReady=()=>/^[1-9]\d*$/.test(process.env.PRO_ROBLOX_PASS_ID||'')&&(process.env.PRO_KEY_ENCRYPTION_SECRET||'').length>=32&&!!process.env.ROBLOX_INVENTORY_API_KEY;
 function status(req){const access=req.user?db.prepare('SELECT expires_at FROM pro_access WHERE user_id=?').get(req.user.id):null;return {required:true,priceRobux:15,lifetime:true,checkoutReady:purchaseReady(),purchaseUrl:purchaseReady()?'https://www.roblox.com/game-pass/'+process.env.PRO_ROBLOX_PASS_ID:null,robloxLinked:!!req.user&&!!db.prepare('SELECT 1 FROM roblox_links WHERE user_id=?').get(req.user.id),loggedIn:!!req.user,isOwner:req.user?.role==='owner',hasAccess:req.user?.role==='owner'||!!access&&(access.expires_at===null||access.expires_at>Date.now()),expiresAt:access?.expires_at??null};}
 const requirePro=(req,res,next)=>status(req).hasAccess?next():res.status(403).json({error:'Pro access required. Redeem an access key to generate AI animations.'});
 const limiter=rateLimit({windowMs:15*60000,limit:12,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/pro/status',(req,res)=>res.set('Cache-Control','no-store').json(status(req)));
 app.post('/api/pro/redeem',auth,limiter,(req,res)=>{
  const key=typeof req.body?.key==='string'?req.body.key.trim().toUpperCase():'';
  if(!/^PRO-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(key))return res.status(400).json({error:'Enter a valid PRO access key.'});
  const redeemed=db.transaction(()=>{const item=db.prepare('SELECT * FROM pro_keys WHERE key_hash=?').get(hash(key));if(!item||item.redeemed_at!==null)return false;
   const now=Date.now(),existing=db.prepare('SELECT expires_at FROM pro_access WHERE user_id=?').get(req.user.id);
   const expires=item.duration_ms===null||existing?.expires_at===null?null:Math.max(now,existing?.expires_at||0)+item.duration_ms;
   db.prepare('INSERT INTO pro_access(user_id,expires_at,activated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET expires_at=excluded.expires_at').run(req.user.id,expires,now);
   db.prepare('UPDATE pro_keys SET redeemed_at=?,redeemed_by=? WHERE key_hash=?').run(now,req.user.id,hash(key));return true;
  })();
  if(!redeemed)return res.status(400).json({error:'Key is invalid or already redeemed.'});
  res.set('Cache-Control','no-store').json(status(req));
 });
 app.post('/api/pro/keys',auth,limiter,(req,res)=>{
  if(req.user.role!=='owner')return res.status(403).json({error:'Only the site owner can create Pro keys.'});
  const {durationHours,lifetime}=req.body||{};
  if(lifetime!==true&&(!Number.isFinite(durationHours)||durationHours<1||durationHours>876000))return res.status(400).json({error:'Choose lifetime or a duration between 1 and 876000 hours.'});
  const duration=lifetime===true?null:Math.round(durationHours*3600000);
  const key=create(duration);res.set('Cache-Control','no-store').json({key,durationHours:duration===null?null:duration/3600000,lifetime:duration===null});
 });
 // Match the verified OAuth identity; never accept a buyer ID from the browser.
 app.post('/api/pro/roblox/check',auth,limiter,async(req,res)=>{
  if(!purchaseReady())return res.status(503).json({error:'Robux purchases are not configured yet.'});
  const linked=db.prepare('SELECT roblox_user_id FROM roblox_links WHERE user_id=?').get(req.user.id);
  if(!linked)return res.status(403).json({error:'Link your Roblox account first.'});
  const secret=process.env.PRO_KEY_ENCRYPTION_SECRET;
  const encryptionKey=crypto.createHash('sha256').update(secret).digest();
  function encrypt(key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey,iv),data=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
  function decrypt(text){const b=Buffer.from(text,'base64'),cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey,b.subarray(0,12));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');}
  try{
   const params=new URLSearchParams({filter:'gamePassIds='+process.env.PRO_ROBLOX_PASS_ID,maxPageSize:'10'});
   const response=await fetch('https://apis.roblox.com/cloud/v2/users/'+linked.roblox_user_id+'/inventory-items?'+params,{headers:{'x-api-key':process.env.ROBLOX_INVENTORY_API_KEY},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!response.ok)return res.status(502).json({error:'Roblox could not verify ownership. Check inventory visibility or try again shortly.'});
   const data=await response.json();
   if(!data.inventoryItems?.some(item=>String(item.gamePassDetails?.gamePassId)===process.env.PRO_ROBLOX_PASS_ID))return res.status(409).json({error:'Purchase not found yet. Buy the pass, then check again after Roblox updates ownership.'});
   const key=db.transaction(()=>{const old=db.prepare('SELECT key_cipher FROM pro_purchases WHERE roblox_user_id=? AND pass_id=?').get(linked.roblox_user_id,process.env.PRO_ROBLOX_PASS_ID);if(old)return decrypt(old.key_cipher);
    const key=create(null);db.prepare('INSERT INTO pro_purchases VALUES(?,?,?,?)').run(linked.roblox_user_id,process.env.PRO_ROBLOX_PASS_ID,encrypt(key),Date.now());return key;
   })();res.set('Cache-Control','no-store').json({key,lifetime:true});
  }catch{return res.status(502).json({error:'Could not verify purchase or retrieve its key. Try again or contact the site owner.'});}
 });
 return {requirePro,proStatus:status};
};
