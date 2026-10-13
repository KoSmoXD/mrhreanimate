'use strict';
/* Community gallery backend. Serves ../docs and /api under one origin.
 * Persistent DATA_DIR is mandatory in production; no secrets in frontend.
 */
const express=require('express');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const multer=require('multer');
const Database=require('better-sqlite3');
const bcrypt=require('bcryptjs');
const archiver=require('archiver');
const crypto=require('node:crypto');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',process.env.TRUST_PROXY==='false'?false:1);
const PORT=Number(process.env.PORT||3000);
const ROOT=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const TMP=path.join(ROOT,'tmp'),UPLOADS=path.join(ROOT,'uploads'),AVATARS=path.join(ROOT,'avatars');
const WEB=path.resolve(__dirname,'../docs');
const PROD=process.env.NODE_ENV==='production';
const COOKIE='mrh_sid',SESSION_MS=14*24*60*60*1000;
const MAX={anim:8*1048576,mp3:35*1048576,lua:2*1048576,avatar:2*1048576};
const OWNER_NAME='Mr_H';
const ownerIsReserved=name=>typeof name==='string'&&name.toLowerCase()===OWNER_NAME.toLowerCase();
const claimSecret=String(process.env.OWNER_SETUP_KEY||'');
for(const dir of [ROOT,TMP,UPLOADS,AVATARS])fs.mkdirSync(dir,{recursive:true});
const db=new Database(path.join(ROOT,'gallery.sqlite'));
db.pragma('journal_mode=WAL');
db.pragma('foreign_keys=ON');
db.pragma('busy_timeout=6000');
db.exec([
'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);',
'CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);',
'CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);',
'CREATE TABLE IF NOT EXISTS animations (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,anim_name TEXT NOT NULL,mp3_name TEXT NOT NULL,lua_name TEXT NOT NULL,size_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);',
'CREATE INDEX IF NOT EXISTS animation_created ON animations(created_at DESC);',
'CREATE INDEX IF NOT EXISTS animation_user ON animations(user_id);'
].join('\n'));
// Upgrade old databases without losing registered accounts or animation files.
const userColumns=db.prepare('PRAGMA table_info(users)').all().map(row=>row.name);
for(const [column,sql] of [
 ['role',"ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'"],
 ['avatar_mime','ALTER TABLE users ADD COLUMN avatar_mime TEXT'],
 ['avatar_rev','ALTER TABLE users ADD COLUMN avatar_rev INTEGER NOT NULL DEFAULT 0']
])if(!userColumns.includes(column))db.exec(sql);
const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');
const usernameValid=s=>typeof s==='string'&&/^[A-Za-z0-9_]{3,24}$/.test(s);
const passwordValid=s=>typeof s==='string'&&Buffer.byteLength(s,'utf8')>=10&&Buffer.byteLength(s,'utf8')<=72;
const publicUser=user=>({
 id:user.id,username:user.username,
 role:user.role==='owner'?'owner':'user',
 avatarUrl:user.avatar_mime?'/api/users/'+user.id+'/avatar?v='+(user.avatar_rev||0):null
});
const fail=(res,status,message)=>res.status(status).json({error:message});
app.use(helmet({contentSecurityPolicy:{directives:{
 defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],
 connectSrc:["'self'"],imgSrc:["'self'","data:"],fontSrc:["'self'"],
 mediaSrc:["'self'","blob:"],objectSrc:["'none'"],frameAncestors:["'none'"],
 baseUri:["'none'"],formAction:["'self'"]
}}}));
app.use(express.json({limit:'16kb'}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:260,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many requests. Please retry later.'}}));
app.use('/api',(req,res,next)=>{
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 const origin=req.get('origin');
 const expected=process.env.PUBLIC_ORIGIN||(req.protocol+'://'+req.get('host'));
 if(origin&&origin!==expected)return fail(res,403,'Cross-origin request rejected.');
 if(!origin&&req.get('sec-fetch-site')==='cross-site')return fail(res,403,'Cross-site request rejected.');
 next();
});
function sessionToken(req){
 const raw=req.get('cookie')||'';
 const item=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const token=item?item.slice(COOKIE.length+1):'';
 return /^[a-zA-Z0-9_-]{40,120}$/.test(token)?token:null;
}
function issueSession(res,userId){
 db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
 const token=crypto.randomBytes(36).toString('base64url');
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hashToken(token),userId,Date.now()+SESSION_MS);
 res.cookie(COOKIE,token,{httpOnly:true,secure:PROD,sameSite:'strict',path:'/',maxAge:SESSION_MS});
}
function expireCookie(res){res.clearCookie(COOKIE,{httpOnly:true,secure:PROD,sameSite:'strict',path:'/'});}
app.use('/api',(req,res,next)=>{
 req.user=null;req.sessionHash=null;
 const token=sessionToken(req);
 if(token){
  const hash=hashToken(token);
  const user=db.prepare('SELECT u.id,u.username,u.role,u.avatar_mime,u.avatar_rev FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(hash,Date.now());
  if(user){req.user=user;req.sessionHash=hash;}
 }
 next();
});
const auth=(req,res,next)=>req.user?next():fail(res,401,'Log in to continue.');
const authLimit=rateLimit({windowMs:15*60*1000,limit:14,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again later.'}});
const registerLimit=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Hourly signup limit reached.'}});
const uploadLimit=rateLimit({windowMs:60*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Hourly upload limit reached.'}});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/me',(req,res)=>req.user?res.json({user:publicUser(req.user)}):fail(res,401,'Not logged in.'));
app.post('/api/register',registerLimit,async(req,res,next)=>{
 try{
  const username=String(req.body?.username||'').trim(),password=req.body?.password;
  if(!usernameValid(username))return fail(res,400,'Username must be 3-24 characters, letters/numbers/underscore.');
  if(!passwordValid(password))return fail(res,400,'Password must be 10-72 UTF-8 bytes.');
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username))return fail(res,409,'Username is already taken.');
  const hash=await bcrypt.hash(password,12),user={id:crypto.randomUUID(),username};
  try{db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(user.id,username,hash,Date.now());}
  catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))return fail(res,409,'Username is already taken.');throw e;}
  issueSession(res,user.id);res.status(201).json({user});
 }catch(e){next(e);}
});
app.post('/api/login',authLimit,async(req,res,next)=>{
 try{
  const username=String(req.body?.username||'').trim(),password=req.body?.password;
  if(!usernameValid(username)||typeof password!=='string'||Buffer.byteLength(password,'utf8')>256)return fail(res,401,'Invalid username or password.');
  const user=db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if(!user||!await bcrypt.compare(password,user.password_hash))return fail(res,401,'Invalid username or password.');
  issueSession(res,user.id);res.json({user:publicUser(user)});
 }catch(e){next(e);}
});
app.post('/api/logout',(req,res)=>{
 if(req.sessionHash)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.sessionHash);
 expireCookie(res);res.json({ok:true});
});
app.patch('/api/me',auth,authLimit,async(req,res,next)=>{
 try{
  const username=String(req.body?.username||'').trim();
  const current=req.body?.currentPassword,newPassword=req.body?.newPassword;
  if(!usernameValid(username))return fail(res,400,'Username must be 3-24 characters, letters/numbers/underscore.');
  if(typeof current!=='string')return fail(res,400,'Current password is required.');
  if(newPassword&&!passwordValid(newPassword))return fail(res,400,'New password must be 10-72 UTF-8 bytes.');
  const own=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(!own||!await bcrypt.compare(current,own.password_hash))return fail(res,403,'Current password is incorrect.');
  if(db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,own.id))return fail(res,409,'Username is already taken.');
  const hash=newPassword?await bcrypt.hash(newPassword,12):own.password_hash;
  db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username,hash,own.id);
  if(newPassword){db.prepare('DELETE FROM sessions WHERE user_id=?').run(own.id);issueSession(res,own.id);}
  res.json({user:{id:own.id,username}});
 }catch(e){next(e);}
});
app.delete('/api/me',auth,authLimit,async(req,res,next)=>{
 try{
  const own=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(!own||typeof req.body?.password!=='string'||!await bcrypt.compare(req.body.password,own.password_hash))return fail(res,403,'Current password is incorrect.');
  const ids=db.prepare('SELECT id FROM animations WHERE user_id=?').all(own.id).map(x=>x.id);
  db.prepare('DELETE FROM users WHERE id=?').run(own.id);
  expireCookie(res);
  await Promise.all(ids.map(id=>fsp.rm(path.join(UPLOADS,id),{recursive:true,force:true}).catch(()=>{})));
  res.json({ok:true});
 }catch(e){next(e);}
});

const uploader=multer({
 storage:multer.diskStorage({destination(req,file,cb){cb(null,TMP);},filename(req,file,cb){cb(null,crypto.randomUUID()+'.tmp');}}),
 limits:{fileSize:MAX.mp3,files:3,fields:1,parts:4},
 fileFilter(req,file,cb){
  const ext={anim:'.anim',mp3:'.mp3',lua:'.lua'}[file.fieldname];
  if(!ext||path.extname(file.originalname).toLowerCase()!==ext)return cb(new Error('Upload one .anim, .mp3 and .lua.'));
  cb(null,true);
 }
}).fields([{name:'anim',maxCount:1},{name:'mp3',maxCount:1},{name:'lua',maxCount:1}]);
async function removeTmp(files){
 await Promise.all(Object.values(files||{}).flat().filter(Boolean).map(f=>fsp.unlink(f.path).catch(()=>{})));
}
function safeName(value){
 const base=path.basename(String(value).replace(/\\/g,'/'));
 return base.replace(/[^a-zA-Z0-9._ ()-]/g,'_').slice(0,110)||'animation';
}
function validateAnim(b){
 let i=0;
 const need=n=>{if(i+n>b.length)throw Error('Truncated .anim data.');};
 const u16=()=>{need(2);const x=b.readUInt16LE(i);i+=2;return x;};
 const u32=()=>{need(4);const x=b.readUInt32LE(i);i+=4;return x;};
 const f32=()=>{need(4);const x=b.readFloatLE(i);i+=4;if(!Number.isFinite(x)||Math.abs(x)>1000000)throw Error('Invalid .anim float.');return x;};
 const str=()=>{const n=u16();if(n>512)throw Error('Oversized animation string.');need(n);i+=n;};
 str();const count=u32();
 if(count<1||count>1500)throw Error('Invalid keyframe count.');
 for(let f=0;f<count;f++){
  const time=f32();if(time<0||time>300)throw Error('Animation time outside supported range.');
  const n=u32();if(n>100)throw Error('Too many poses.');
  for(let p=0;p<n;p++){str();f32();str();str();for(let k=0;k<12;k++)f32();}
 }
 if(i!==b.length)throw Error('Unexpected data at end of animation.');
}
function card(row){return {id:row.id,userId:row.user_id,username:row.username,title:row.title,createdAt:new Date(row.created_at).toISOString(),sizeBytes:row.size_bytes};}
app.get('/api/animations',(req,res)=>{
 const limit=Math.min(60,Math.max(1,parseInt(req.query.limit,10)||32));
 const offset=Math.min(50000,Math.max(0,parseInt(req.query.offset,10)||0));
 const q=String(req.query.q||'').slice(0,80);
 const where=q?'WHERE a.title LIKE ? OR u.username LIKE ?':'';
 const params=q?['%'+q+'%','%'+q+'%']:[];
 const total=db.prepare('SELECT COUNT(*) AS count FROM animations a JOIN users u ON u.id=a.user_id '+where).get(...params).count;
 const items=db.prepare('SELECT a.*,u.username FROM animations a JOIN users u ON u.id=a.user_id '+where+
  ' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?').all(...params,limit,offset).map(card);
 res.json({items,total});
});
app.post('/api/animations',auth,uploadLimit,(req,res,next)=>{
 uploader(req,res,async(err)=>{
  if(err){await removeTmp(req.files);return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'File too large.':err.message||'Upload failed.');}
  const files=req.files||{},file=key=>Array.isArray(files[key])?files[key][0]:null;
  const id=crypto.randomUUID(),folder=path.join(UPLOADS,id);
  try{
   const title=String(req.body?.title||'').trim();
   if(title.length<2||title.length>80)throw Error('Animation name must be 2-80 characters.');
   if(!file('anim')||!file('mp3')||!file('lua')||Object.values(files).flat().length!==3)throw Error('All three files are required.');
   for(const key of ['anim','mp3','lua'])if(file(key).size<1||file(key).size>MAX[key])throw Error(key+' is too large.');
   validateAnim(await fsp.readFile(file('anim').path));
   if((await fsp.readFile(file('lua').path)).includes(0))throw Error('Lua module must be a text file.');
   const sound=await fsp.open(file('mp3').path,'r'),header=Buffer.alloc(4);
   try{await sound.read(header,0,4,0);}finally{await sound.close();}
   if(!(header.toString('ascii',0,3)==='ID3'||(header[0]===255&&(header[1]&224)===224)))throw Error('Music is not valid MP3 data.');
   await fsp.mkdir(folder);
   for(const key of ['anim','mp3','lua'])await fsp.rename(file(key).path,path.join(folder,key));
   const size=['anim','mp3','lua'].reduce((n,k)=>n+file(k).size,0);
   const names=['anim','mp3','lua'].map(k=>safeName(file(k).originalname)),created=Date.now();
   db.prepare('INSERT INTO animations(id,user_id,title,anim_name,mp3_name,lua_name,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id,req.user.id,title,...names,size,created);
   res.status(201).json({animation:card({id,user_id:req.user.id,username:req.user.username,title,size_bytes:size,created_at:created})});
  }catch(e){await fsp.rm(folder,{recursive:true,force:true}).catch(()=>{});return fail(res,400,e.message||'Upload validation failed.');}
  finally{await removeTmp(files);}
 });
});
app.get('/api/animations/:id/download',(req,res,next)=>{
 const item=db.prepare('SELECT * FROM animations WHERE id=?').get(req.params.id);
 if(!item)return fail(res,404,'Animation not found.');
 const dir=path.join(UPLOADS,item.id);
 if(['anim','mp3','lua'].some(key=>!fs.existsSync(path.join(dir,key))))return fail(res,410,'Animation files unavailable.');
 const name=safeName(item.title).replace(/["\\]/g,'_')||'animation';
 res.setHeader('Content-Type','application/zip');
 res.setHeader('Content-Disposition','attachment; filename="'+name+'.zip"');
 res.setHeader('Cache-Control','no-store');
 const archive=archiver('zip',{zlib:{level:0}});
 archive.on('error',e=>{if(res.headersSent)res.destroy(e);else next(e);});
 res.on('close',()=>{if(!res.writableEnded)archive.abort();});
 archive.pipe(res);
 archive.file(path.join(dir,'anim'),{name:'UhhhhhhReanim/Content/Anims/'+safeName(item.anim_name)});
 archive.file(path.join(dir,'mp3'),{name:'UhhhhhhReanim/Content/Sounds/'+safeName(item.mp3_name)});
 archive.file(path.join(dir,'lua'),{name:'UhhhhhhReanim/Modules/'+safeName(item.lua_name)});
 archive.finalize().catch(next);
});
app.delete('/api/animations/:id',auth,async(req,res,next)=>{
 try{
  const row=db.prepare('SELECT id,user_id FROM animations WHERE id=?').get(req.params.id);
  if(!row)return fail(res,404,'Animation not found.');
  if(row.user_id!==req.user.id)return fail(res,403,'Only the uploader can delete this animation.');
  db.prepare('DELETE FROM animations WHERE id=?').run(row.id);
  await fsp.rm(path.join(UPLOADS,row.id),{force:true,recursive:true});
  res.json({ok:true});
 }catch(e){next(e);}
});
app.use(express.static(WEB,{index:'index.html',dotfiles:'deny',maxAge:'1h'}));
app.get('/',(req,res)=>res.sendFile(path.join(WEB,'index.html')));
app.use((req,res)=>fail(res,404,'Not found.'));
app.use((err,req,res,next)=>{
 console.error('Mr H server error:',err.message);
 if(res.headersSent)return next(err);
 fail(res,500,'Internal server error.');
});
const server=app.listen(PORT,()=>console.log('Mr H gallery listening on '+PORT+'; persistent storage: '+ROOT));
const shutdown=()=>server.close(()=>{db.close();process.exit(0);});
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
