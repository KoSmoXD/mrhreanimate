'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),Database=require('better-sqlite3'),Motion=require('../../docs/motion-core');
test('PLUS keys are owner-generated only; expiry and OAuth remain server verified',async()=>{
 const saved={...process.env},realFetch=global.fetch,db=new Database(':memory:');
 db.pragma('foreign_keys=ON');db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,password_hash TEXT,created_at INTEGER);');
 for(const id of ['owner','alice','bob','rogue','shortuser'])db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,id==='owner'?'Mr_H':id,'unused',Date.now());
 const app=express();app.use(express.json());app.use((req,res,next)=>{const id=req.headers['x-user'];if(['owner','alice','bob','rogue','shortuser'].includes(id))req.user={id,username:id==='owner'?'Mr_H':id,role:['owner','rogue'].includes(id)?'owner':'user'};next()});
 const auth=(req,res,next)=>req.user?next():res.sendStatus(401),rateLimit=()=>((req,res,next)=>next());
 let session;
 require('../roblox-login')(app,{db,issueSession:(res,id)=>{session=id},bcrypt:{hash:async()=> 'unused'},rateLimit});
 const pro=require('../pro-access')(app,{db,auth,rateLimit});require('../animation-ai')(app,{auth,rateLimit,...pro});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const req=(path,body,user='alice',opts={})=>realFetch(base+path,{...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),headers:{'Content-Type':'application/json',...(user?{'x-user':user}:{})},...opts});
 try{
  assert.equal((await req('/api/pro/keys',{count:2,days:30,lifetime:false})).status,403);
  assert.equal((await req('/api/pro/keys',{count:2,days:30,lifetime:false},null)).status,401);
  assert.equal((await req('/api/pro/keys',{count:2,days:30,lifetime:false},'rogue')).status,403,'owner role with a different username is blocked');
  assert.equal((await req('/api/pro/keys',{count:11,days:30,lifetime:false},'owner')).status,400);
  const ownerStatus=await(await req('/api/pro/status',undefined,'owner')).json();
  assert.equal(ownerStatus.isKeyGenerator,true);assert.equal(ownerStatus.hasAccess,true);
  const guestStatus=await(await req('/api/pro/status')).json();
  assert.equal(guestStatus.isKeyGenerator,false);
  const generatedResponse=await req('/api/pro/keys',{count:3,days:15,lifetime:false},'owner');
  assert.equal(generatedResponse.status,200);
  assert.match(generatedResponse.headers.get('cache-control'),/no-store/);
  const generated=await generatedResponse.json();assert.equal(generated.keys.length,3);
  for(const key of generated.keys)assert.match(key,/^PLUS-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(new Set(generated.keys).size,3);
  assert(!JSON.stringify(db.prepare('SELECT * FROM pro_keys').all()).includes(generated.keys[0]),'plaintext keys are not stored');
  assert.equal((await req('/api/pro/redeem',{key:generated.keys[0]},'bob')).status,200);
  assert.equal((await req('/api/pro/redeem',{key:generated.keys[0]},'bob')).status,400);
  const lifetimeResponse=await req('/api/pro/keys',{count:1,days:null,lifetime:true},'owner');
  assert.equal(lifetimeResponse.status,200);
  assert.equal((await lifetimeResponse.json()).keys.length,1);
  // Custom durations can combine days/hours/minutes/seconds, including one second.
  const mixed=await req('/api/pro/keys',{count:1,lifetime:false,days:1,hours:2,minutes:3,seconds:4},'owner');
  assert.equal(mixed.status,200);
  const mixedKey=(await mixed.json()).keys[0];
  const hashKey=key=>require('node:crypto').createHash('sha256').update(key).digest('hex');
  assert.equal(db.prepare('SELECT duration_ms FROM pro_keys WHERE key_hash=?').get(hashKey(mixedKey)).duration_ms,93784000);
  const short=await req('/api/pro/keys',{count:1,lifetime:false,days:0,hours:0,minutes:0,seconds:1},'owner');
  assert.equal(short.status,200);
  const shortKey=(await short.json()).keys[0];
  assert.equal(db.prepare('SELECT duration_ms FROM pro_keys WHERE key_hash=?').get(hashKey(shortKey)).duration_ms,1000);
  const shortRedeemed=await req('/api/pro/redeem',{key:shortKey},'shortuser');
  assert.equal(shortRedeemed.status,200);
  const shortStatus=await shortRedeemed.json();
  assert(shortStatus.hasAccess);assert(Math.abs(shortStatus.expiresAt-Date.now()-1000)<1500);
  for(const parts of [
   {days:0,hours:0,minutes:0,seconds:0},
   {days:3650,hours:0,minutes:0,seconds:1},
   {days:0,hours:0,minutes:60,seconds:0},
   {days:0,hours:24,minutes:0,seconds:0},
   {days:0,hours:0,minutes:0,seconds:-1},
   {days:0,hours:0,minutes:0,seconds:0.5}
  ])assert.equal((await req('/api/pro/keys',{count:1,lifetime:false,...parts},'owner')).status,400);
  const {createKey}=require('../scripts/create-plus-key');
  assert.throws(()=>createKey(db,{hours:0}));
  assert.throws(()=>createKey(db,{durationMs:999}));
  assert.throws(()=>createKey(db,{durationMs:3650*86400000+1000}));
  assert.equal((await req('/api/animation-ai/generate',{apiKey:'personal-key',provider:'openai',model:'model',prompt:'wave',duration:2})).status,403);
  const made={key:createKey(db,{hours:24})};assert.match(made.key,/^PLUS-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert(!JSON.stringify(db.prepare('SELECT * FROM pro_keys').all()).includes(made.key));
  assert.equal((await req('/api/pro/redeem',{key:made.key},null)).status,401);
  const access=await(await req('/api/pro/redeem',{key:made.key})).json();assert(access.hasAccess);assert(Math.abs(access.expiresAt-Date.now()-86400000)<2000);
  assert.equal((await req('/api/pro/redeem',{key:made.key},'bob')).status,400);
  db.prepare('UPDATE pro_access SET expires_at=0 WHERE user_id=?').run('alice');assert.equal((await(await req('/api/pro/status')).json()).hasAccess,false);
  const permanent={key:createKey(db,{lifetime:true})};await req('/api/pro/redeem',{key:permanent.key});assert.equal((await(await req('/api/pro/status')).json()).expiresAt,null);
  const key='personal-test-key';
  for(const provider of ['openai','anthropic','gemini']){
   global.fetch=async(url,opts)=>{const headers=opts.headers;assert.equal(headers.Authorization||headers['x-api-key']||headers['x-goog-api-key'],provider==='openai'?'Bearer '+key:key);assert.equal(opts.redirect,'error');const clip=JSON.stringify(Motion.blank());return {ok:true,json:async()=>provider==='openai'?{status:'completed',output:[{content:[{type:'output_text',text:clip}]}]}:provider==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text:'```json\n'+clip+'\n```'}]}:{candidates:[{finishReason:'STOP',content:{parts:[{text:clip}]}}]}}};
   const r=await req('/api/animation-ai/generate',{provider,apiKey:key,model:'test-model',prompt:'wave hello',duration:2});assert.equal(r.status,200,await r.clone().text());assert(!(await r.text()).includes(key));
  }
  assert.equal((await req('/api/animation-ai/generate',{provider:'http://127.0.0.1',apiKey:key,model:'test',prompt:'wave',duration:2})).status,400);
  process.env.PRO_ROBLOX_PASS_ID='123';process.env.PRO_KEY_ENCRYPTION_SECRET='x'.repeat(40);process.env.ROBLOX_INVENTORY_API_KEY='inventory-test';
  global.fetch=()=>{throw Error('Purchase verification must never call Roblox')};
  assert.equal((await req('/api/pro/roblox/check',{})).status,404);
  const plusStatus=await(await req('/api/pro/status')).json();
  assert(!('purchaseUrl' in plusStatus));assert(!('priceRobux' in plusStatus));
  const legacy='PRO-ABCDE-FGHJK-LMNPQ';
  db.prepare('INSERT INTO pro_keys VALUES(?,?,?,NULL,NULL)').run(require('node:crypto').createHash('sha256').update(legacy).digest('hex'),3600000,Date.now());
  assert.equal((await req('/api/pro/redeem',{key:legacy},'bob')).status,200);
  process.env.ROBLOX_OAUTH_CLIENT_ID='client';process.env.ROBLOX_OAUTH_CLIENT_SECRET='oauth-secret';process.env.ROBLOX_OAUTH_REDIRECT_URI='https://example.com/api/auth/roblox/callback';
  const start=await req('/api/auth/roblox/start',undefined,'bob',{redirect:'manual'}),url=new URL(start.headers.get('location')),state=url.searchParams.get('state');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const cookie=start.headers.get('set-cookie').split(';')[0];assert(start.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.equal((await req('/api/auth/roblox/callback?state='+state+'&code=code',undefined,null,{redirect:'manual'})).status,400);
  global.fetch=async(url,opts)=>url.endsWith('/token')?{ok:true,json:async()=>({access_token:'access'})}:{ok:true,json:async()=>({sub:'654'})};
  const callback=await req('/api/auth/roblox/callback?state='+state+'&code=code',undefined,null,{headers:{cookie},redirect:'manual'});assert.equal(callback.status,302);assert.equal(session,'bob');assert.equal(db.prepare('SELECT user_id FROM roblox_links WHERE roblox_user_id=?').get('654').user_id,'bob');
  assert.equal((await req('/api/auth/roblox/callback?state='+state+'&code=code',undefined,null,{headers:{cookie},redirect:'manual'})).status,400);
 }finally{global.fetch=realFetch;for(const k of ['PRO_ROBLOX_PASS_ID','PRO_KEY_ENCRYPTION_SECRET','ROBLOX_INVENTORY_API_KEY','ROBLOX_OAUTH_CLIENT_ID','ROBLOX_OAUTH_CLIENT_SECRET','ROBLOX_OAUTH_REDIRECT_URI']){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k]}await new Promise(r=>server.close(r));db.close()}
});
