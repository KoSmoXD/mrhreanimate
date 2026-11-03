'use strict';
const crypto=require('node:crypto');
module.exports=function(app,{db,issueSession,bcrypt,rateLimit}){
 db.exec(`CREATE TABLE IF NOT EXISTS roblox_links(roblox_user_id TEXT PRIMARY KEY,user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS roblox_oauth_states(state_hash TEXT PRIMARY KEY,verifier TEXT NOT NULL,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);`);
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
 const configured=()=>!!(process.env.ROBLOX_OAUTH_CLIENT_ID&&process.env.ROBLOX_OAUTH_CLIENT_SECRET&&process.env.ROBLOX_OAUTH_REDIRECT_URI?.startsWith('https://'));
 const cookieOptions={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/api/auth/roblox',maxAge:600000};
 app.get('/api/auth/roblox/status',(req,res)=>res.set('Cache-Control','no-store').json({configured:configured(),linked:!!req.user&&!!db.prepare('SELECT 1 FROM roblox_links WHERE user_id=?').get(req.user.id)}));
 app.get('/api/auth/roblox/start',rateLimit({windowMs:600000,limit:20,standardHeaders:'draft-7',legacyHeaders:false}),(req,res)=>{
  if(!configured())return res.status(503).send('Roblox sign-in is not configured yet. Use your existing site login.');
  const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');
  db.prepare('DELETE FROM roblox_oauth_states WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO roblox_oauth_states VALUES(?,?,?,?)').run(hash(state),verifier,req.user?.id||null,Date.now()+600000);
  res.cookie('mrh_roblox_state',state,cookieOptions);
  const params=new URLSearchParams({client_id:process.env.ROBLOX_OAUTH_CLIENT_ID,redirect_uri:process.env.ROBLOX_OAUTH_REDIRECT_URI,response_type:'code',scope:'openid profile',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  res.set('Cache-Control','no-store').redirect('https://apis.roblox.com/oauth/v1/authorize?'+params);
 });
 app.get('/api/auth/roblox/callback',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const cookie=(req.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('mrh_roblox_state='))?.slice('mrh_roblox_state='.length);
  const state=req.query.state;
  if(!configured()||typeof state!=='string'||state.length>100||!cookie||cookie!==state)return res.status(400).send('Roblox sign-in expired or could not be verified. Start sign-in again.');
  const entry=db.prepare('SELECT * FROM roblox_oauth_states WHERE state_hash=? AND expires_at>?').get(hash(state),Date.now());
  if(!entry)return res.status(400).send('Roblox sign-in expired. Start again.');
  db.prepare('DELETE FROM roblox_oauth_states WHERE state_hash=?').run(hash(state));res.clearCookie('mrh_roblox_state',{httpOnly:true,secure:cookieOptions.secure,sameSite:'lax',path:cookieOptions.path});
  if(req.query.error)return res.redirect('/studio.html?roblox=cancelled');
  if(typeof req.query.code!=='string'||req.query.code.length>4096)return res.status(400).send('Roblox did not return an authorization code.');
  try{
   const tokenResponse=await fetch('https://apis.roblox.com/oauth/v1/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:process.env.ROBLOX_OAUTH_CLIENT_ID,client_secret:process.env.ROBLOX_OAUTH_CLIENT_SECRET,code:req.query.code,code_verifier:entry.verifier,redirect_uri:process.env.ROBLOX_OAUTH_REDIRECT_URI}),signal:AbortSignal.timeout(15000)});
   if(!tokenResponse.ok)throw Error('token');const token=await tokenResponse.json();if(typeof token.access_token!=='string')throw Error('token');
   const userResponse=await fetch('https://apis.roblox.com/oauth/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!userResponse.ok)throw Error('userinfo');const profile=await userResponse.json();if(typeof profile.sub!=='string'||!/^[1-9]\d{0,18}$/.test(profile.sub))throw Error('identity');
   const linked=db.prepare('SELECT user_id FROM roblox_links WHERE roblox_user_id=?').get(profile.sub);
   if(entry.user_id&&linked&&linked.user_id!==entry.user_id)return res.status(409).send('This Roblox account is linked to another site account.');
   let userId=entry.user_id||linked?.user_id;
   if(!userId){userId=crypto.randomUUID();const username='rbx_'+crypto.randomBytes(8).toString('hex'),passwordHash=await bcrypt.hash(crypto.randomBytes(48).toString('base64url'),12);
    db.transaction(()=>{db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(userId,username,passwordHash,Date.now());db.prepare('INSERT INTO roblox_links VALUES(?,?)').run(profile.sub,userId)})();
   }else if(!linked){if(db.prepare('SELECT 1 FROM roblox_links WHERE user_id=?').get(userId))return res.status(409).send('Your site account is already linked to another Roblox account.');db.prepare('INSERT INTO roblox_links VALUES(?,?)').run(profile.sub,userId);}
   issueSession(res,userId);res.redirect('/studio.html?roblox=connected');
  }catch{return res.status(502).send('Could not complete Roblox sign-in. Try again or use your site login.');}
 });
};
