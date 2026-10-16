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
const {makeMoveset,ROLES}=require('./moveset-generator');
const setupCommunity=require('./community');
const robloxPreview=require('./roblox-avatar');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
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
app.use('/api/roblox-preview',robloxPreview);
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

const avatarLimit=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many profile picture changes.'}});
const ownerLimit=rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many owner setup attempts.'}});
function ownerClaimKeyMatches(key){
 if(!claimSecret||claimSecret.length<32||typeof key!=='string')return false;
 const expected=crypto.createHash('sha256').update(claimSecret).digest();
 const incoming=crypto.createHash('sha256').update(key).digest();
 return crypto.timingSafeEqual(expected,incoming);
}
function imageMime(buffer){
 if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return 'image/jpeg';
 if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
function avatarFile(id){return path.join(AVATARS,id+'.img');}
const avatarUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX.avatar,files:1,fields:0,parts:1}}).single('avatar');
app.get('/api/users/:id/avatar',(req,res)=>{
 const user=db.prepare('SELECT id,avatar_mime FROM users WHERE id=?').get(req.params.id);
 if(!user||!user.avatar_mime)return fail(res,404,'No profile picture available.');
 const file=avatarFile(user.id);
 if(!fs.existsSync(file))return fail(res,404,'Profile picture unavailable.');
 res.setHeader('Content-Type',user.avatar_mime);
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cache-Control','public,max-age=86400');
 res.sendFile(file);
});
app.put('/api/me/avatar',auth,avatarLimit,(req,res)=>{
 avatarUpload(req,res,async(err)=>{
  if(err)return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'Profile picture must be under 2 MB.':err.message||'Invalid upload.');
  if(!req.file||!req.file.buffer)return fail(res,400,'Choose a PNG, JPG or WebP image.');
  const mime=imageMime(req.file.buffer);
  if(!mime)return fail(res,400,'Only PNG, JPG and WebP images are supported.');
  try{
   const file=avatarFile(req.user.id),temp=file+'.'+crypto.randomUUID()+'.tmp';
   await fsp.writeFile(temp,req.file.buffer,{flag:'wx'});
   await fsp.rename(temp,file);
   const rev=Date.now();
   db.prepare('UPDATE users SET avatar_mime=?,avatar_rev=? WHERE id=?').run(mime,rev,req.user.id);
   res.json({user:publicUser({...req.user,avatar_mime:mime,avatar_rev:rev})});
  }catch(e){console.error('Avatar upload:',e.message);return fail(res,500,'Could not save profile picture.');}
 });
});
app.delete('/api/me/avatar',auth,avatarLimit,async(req,res,next)=>{
 try{
  db.prepare('UPDATE users SET avatar_mime=NULL,avatar_rev=? WHERE id=?').run(Date.now(),req.user.id);
  await fsp.rm(avatarFile(req.user.id),{force:true});
  res.json({user:publicUser({...req.user,avatar_mime:null})});
 }catch(e){next(e);}
});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/me',(req,res)=>req.user?res.json({user:publicUser(req.user)}):fail(res,401,'Not logged in.'));
app.post('/api/register',registerLimit,async(req,res,next)=>{
 try{
  const username=String(req.body?.username||'').trim(),password=req.body?.password;
  if(!usernameValid(username))return fail(res,400,'Username must be 3-24 characters, letters/numbers/underscore.');
  if(!passwordValid(password))return fail(res,400,'Password must be 10-72 UTF-8 bytes.');
  if(ownerIsReserved(username))return fail(res,403,'Mr_H is reserved for the server owner. Use Owner setup.');
  if(db.prepare('SELECT id FROM users WHERE username=?').get(username))return fail(res,409,'Username is already taken.');
  const hash=await bcrypt.hash(password,12),user={id:crypto.randomUUID(),username};
  try{db.prepare('INSERT INTO users(id,username,password_hash,created_at) VALUES(?,?,?,?)').run(user.id,username,hash,Date.now());}
  catch(e){if(e.code?.startsWith('SQLITE_CONSTRAINT'))return fail(res,409,'Username is already taken.');throw e;}
  issueSession(res,user.id);res.status(201).json({user});
 }catch(e){next(e);}
});
// One-time secure setup: the owner code only exists in the server environment,
// and only this endpoint can grant admin permissions.
app.post('/api/owner/claim',ownerLimit,async(req,res,next)=>{
 try{
  const key=req.body?.setupKey,password=req.body?.password;
  if(!ownerClaimKeyMatches(key))return fail(res,403,'Invalid owner setup key.');
  if(!passwordValid(password))return fail(res,400,'Owner password must be 10-72 UTF-8 bytes.');
  if(db.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get())
   return fail(res,409,'Owner account already claimed. Log in as Mr_H.');
  const existing=db.prepare('SELECT id FROM users WHERE username=?').get(OWNER_NAME);
  const hash=await bcrypt.hash(password,12),ownerId=existing?.id||crypto.randomUUID();
  db.transaction(()=>{
   if(db.prepare("SELECT id FROM users WHERE role='owner' LIMIT 1").get())throw Error('OWNER_ALREADY_CLAIMED');
   if(existing)db.prepare("UPDATE users SET username=?,password_hash=?,role='owner' WHERE id=?").run(OWNER_NAME,hash,ownerId);
   else db.prepare("INSERT INTO users(id,username,password_hash,created_at,role) VALUES(?,?,?,?,'owner')").run(ownerId,OWNER_NAME,hash,Date.now());
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(ownerId);
  })();
  issueSession(res,ownerId);
  res.status(201).json({user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(ownerId))});
 }catch(e){if(e.message==='OWNER_ALREADY_CLAIMED')return fail(res,409,'Owner account already claimed.');next(e);}
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
  if(ownerIsReserved(username)&&req.user.role!=='owner')return fail(res,403,'The name Mr_H is reserved for the server owner.');
  if(req.user.role==='owner'&&username!==OWNER_NAME)return fail(res,403,'The owner username cannot be changed.');
  if(typeof current!=='string')return fail(res,400,'Current password is required.');
  if(newPassword&&!passwordValid(newPassword))return fail(res,400,'New password must be 10-72 UTF-8 bytes.');
  const own=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(!own||!await bcrypt.compare(current,own.password_hash))return fail(res,403,'Current password is incorrect.');
  if(db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,own.id))return fail(res,409,'Username is already taken.');
  const hash=newPassword?await bcrypt.hash(newPassword,12):own.password_hash;
  db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username,hash,own.id);
  if(newPassword){db.prepare('DELETE FROM sessions WHERE user_id=?').run(own.id);issueSession(res,own.id);}
  res.json({user:publicUser({...own,username})});
 }catch(e){next(e);}
});
app.delete('/api/me',auth,authLimit,async(req,res,next)=>{
 try{
  const own=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if(!own||typeof req.body?.password!=='string'||!await bcrypt.compare(req.body.password,own.password_hash))return fail(res,403,'Current password is incorrect.');
  if(own.role==='owner')return fail(res,403,'The owner account cannot be deleted.');
  const ids=db.prepare('SELECT id FROM animations WHERE user_id=?').all(own.id).map(x=>x.id);
  const moveIds=db.prepare('SELECT id FROM movesets WHERE user_id=?').all(own.id).map(x=>x.id);
  db.prepare('DELETE FROM users WHERE id=?').run(own.id);
  expireCookie(res);
  await Promise.all(ids.map(id=>fsp.rm(path.join(UPLOADS,id),{recursive:true,force:true}).catch(()=>{})));
  await Promise.all(moveIds.map(id=>fsp.rm(path.join(ROOT,'movesets',id+'.zip'),{force:true}).catch(()=>{})));
  await fsp.rm(avatarFile(own.id),{force:true}).catch(()=>{});
  res.json({ok:true});
 }catch(e){next(e);}
});

const uploader=multer({
 storage:multer.diskStorage({destination(req,file,cb){cb(null,TMP);},filename(req,file,cb){cb(null,crypto.randomUUID()+'.tmp');}}),
 limits:{fileSize:MAX.mp3,files:3,fields:2,parts:5},
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
 let duration=0;
 if(count<1||count>1500)throw Error('Invalid keyframe count.');
 for(let f=0;f<count;f++){
  const time=f32();if(time<0||time>300)throw Error('Animation time outside supported range.');
  duration=Math.max(duration,time);
  const n=u32();if(n>100)throw Error('Too many poses.');
  for(let p=0;p<n;p++){str();f32();str();str();for(let k=0;k<12;k++)f32();}
 }
 if(i!==b.length)throw Error('Unexpected data at end of animation.');
 return {duration,count};
}
function card(row){
 return {id:row.id,userId:row.user_id,username:row.username,
  description:row.description||'',commentCount:row.comment_count||0,
  role:row.role==='owner'?'owner':'user',
  avatarUrl:row.avatar_mime?'/api/users/'+row.user_id+'/avatar?v='+(row.avatar_rev||0):null,
  title:row.title,createdAt:new Date(row.created_at).toISOString(),sizeBytes:row.size_bytes};
}

// Model conversion is limited to Uhhhhhh KeyframeSequence animation assets.
// The STEVE converter runs in a separate Python process with resource limits.
const convertLimiter=rateLimit({windowMs:3600000,limit:14,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Conversion rate limit reached.'}});
const convertUploads=multer({
 storage:multer.memoryStorage(),
 limits:{files:2,fields:3,parts:5,fileSize:25*1048576},
 fileFilter(req,file,cb){
  const ext=path.extname(file.originalname).toLowerCase();
  if(file.fieldname==='model'&&['.rbxm','.rbxmx'].includes(ext))return cb(null,true);
  if(file.fieldname==='music'&&ext==='.mp3')return cb(null,true);
  cb(new Error('Upload a Roblox .rbxm/.rbxmx and optional .mp3 only.'));
 }
}).fields([{name:'model',maxCount:1},{name:'music',maxCount:1}]);
function luaLiteral(s){return JSON.stringify(String(s).replace(/[\x00-\x1f]/g,' ').slice(0,150));}
function descriptionFromInput(raw,fallback){
 if(raw==null||raw==='')return fallback;
 if(typeof raw!=='string')throw Error('Description must be text.');
 const value=raw.trim().replace(/\r\n?/g,'\n');
 if(Array.from(value).length>500||Buffer.byteLength(value,'utf8')>2000)throw Error('Description must be 500 characters or fewer.');
 return value||fallback;
}
function luaDescription(value){
 // JSON string escaping is compatible with Luau quoted strings, including
 // double-quotes, backslashes and newlines; preserve Unicode characters.
 return JSON.stringify(value);
}
function makeDanceModule(seq,trackName,soundName,looped,description){
 const assets=[trackName,...(soundName?[soundName]:[])].map(luaLiteral).join(', ');
 return [
  '-- Uhhhhhh Reanimate animation module, generated by Mr H.',
  '-- Review scripts before running downloads from other users.',
  'local modules = {}',
  'table.insert(modules, function()',
  '    local m = {}',
  '    m.ModuleType = "DANCE"',
  '    m.Name = '+luaLiteral(seq.name),
  '    m.Description = '+luaDescription(description),
  '    m.Assets = {'+assets+'}',
  '    m.Config = function(parent) end',
  '    local animator = nil',
  '    local elapsed = 0',
  '    m.Init = function(figure)',
  soundName?'        SetOverrideDanceMusic(AssetGetContentId('+luaLiteral(soundName)+'), '+luaLiteral(seq.name)+', 1)':'        elapsed = 0',
  '        animator = AnimLib.Animator.new()',
  '        animator.rig = figure',
  '        animator.looped = '+(looped?'true':'false'),
  '        animator.track = AnimLib.Track.fromfile(AssetGetPathFromFilename('+luaLiteral(trackName)+'))',
  '    end',
  '    m.Update = function(dt, figure)',
  '        if not animator then return end',
  ...(soundName?[]:['        elapsed = elapsed + dt']),
  '        animator:Step('+(soundName?'GetOverrideDanceMusicTime()':'elapsed')+')',
  '    end',
  '    m.Destroy = function(figure)',
  '        animator = nil',
  ...(soundName?['        SetOverrideDanceMusic()']:[]),
  '    end',
  '    return m',
  'end)',
  'return modules',''
 ].join('\n');
}
app.post('/api/make-animation',convertLimiter,(req,res)=>{
 convertUploads(req,res,async err=>{
  if(err)return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'Uploaded file is too large.':err.message||'Invalid model upload.');
  const model=req.files?.model?.[0],music=req.files?.music?.[0];
  if(!model?.buffer)return fail(res,400,'Choose a .rbxm or .rbxmx model.');
  if(model.size<32||model.size>4*1048576)return fail(res,400,'Model must be under 4 MB.');
  if(music&&(music.size<128||music.size>25*1048576))return fail(res,400,'MP3 must be under 25 MB.');
  if(music){
   const head=music.buffer;
   if(!(head.toString('ascii',0,3)==='ID3'||(head[0]===255&&(head[1]&224)===224)))
    return fail(res,400,'Music is not recognized as MP3.');
  }
  const title=String(req.body?.name||'').trim().slice(0,80);
  const looped=String(req.body?.loop)==='true';
  let description;
  try{description=descriptionFromInput(req.body?.description,'Converted KeyframeSequence for Uhhhhhh');}
  catch(error){return fail(res,400,error.message);}
  let folder,streamed=false;
  try{
   folder=await fsp.mkdtemp(path.join(TMP,'make-'));
   const output=path.join(folder,'output');
   const input=path.join(folder,path.extname(model.originalname).toLowerCase()==='.rbxmx'?'input.rbxmx':'input.rbxm');
   await fsp.mkdir(output);
   await fsp.writeFile(input,model.buffer,{flag:'wx'});
   try{
    await execFileAsync('python3',[path.join(__dirname,'tools','convert_model.py'),input,output],{
      timeout:14000,maxBuffer:32768,windowsHide:true
    });
   }catch(error){
    throw Error(String(error.stderr||error.message||'Model conversion error').trim().slice(0,230));
   }
   const sequences=JSON.parse(await fsp.readFile(path.join(output,'_results.json'),'utf8'));
   if(!Array.isArray(sequences)||!sequences.length||sequences.length>20)throw Error('No valid KeyframeSequences converted.');
   const soundName=music?safeName(music.originalname):null;
   const archive=archiver('zip',{zlib:{level:0}});
   archive.on('error',error=>{if(res.headersSent)res.destroy(error);else res.destroy(error);});
   res.setHeader('Content-Type','application/zip');
   res.setHeader('Content-Disposition','attachment; filename="'+safeName(title||sequences[0].name).replace(/\.zip$/i,'')+'_Uhhhhhh.zip"');
   res.setHeader('Cache-Control','no-store');
   let cleaned=false;
   const cleanup=()=>{
    if(cleaned)return;cleaned=true;
    fsp.rm(folder,{recursive:true,force:true}).catch(()=>{});
   };
   res.once('finish',cleanup);
   res.once('close',()=>{if(!res.writableEnded)archive.abort();cleanup();});
   for(const [index,seq] of sequences.entries()){
    const trackName=seq.filename;
    if(!/^[A-Za-z0-9_ -]{1,60}\.anim$/.test(trackName))throw Error('Invalid converted filename.');
    archive.file(path.join(output,trackName),{name:'UhhhhhhReanim/Content/Anims/'+trackName});
    const moduleName='Uhhhhhh_'+index+'_'+trackName.slice(0,-5).replace(/[^A-Za-z0-9_-]/g,'_')+'.lua';
    archive.append(makeDanceModule(seq,trackName,soundName,looped,description),{name:'UhhhhhhReanim/Modules/'+moduleName});
   }
   if(music)archive.append(music.buffer,{name:'UhhhhhhReanim/Content/Sounds/'+soundName});
   archive.pipe(res);
   streamed=true;
   await archive.finalize();
  }catch(error){
   if(!streamed&&folder)await fsp.rm(folder,{recursive:true,force:true}).catch(()=>{});
   if(res.headersSent)return res.destroy(error);
   return fail(res,400,'Conversion failed: '+String(error.message||error).slice(0,240));
  }
 });
});

// Shared converter for incoming Roblox KeyframeSequence models.
// Runs STEVE's MIT-licensed converter in a CPU/memory-limited child process.
async function convertRobloxModel(inputPath,outputDir){
 await fsp.mkdir(outputDir,{recursive:true});
 try{
  await execFileAsync('python3',[
   path.join(__dirname,'tools','convert_model.py'),inputPath,outputDir
  ],{timeout:14000,maxBuffer:32768,windowsHide:true});
 }catch(error){
  const message=String(error.stderr||error.message||'Invalid Roblox model.').trim().slice(0,200);
  throw Error('RBXM conversion failed: '+message);
 }
 const sequences=JSON.parse(await fsp.readFile(path.join(outputDir,'_results.json'),'utf8'));
 if(!Array.isArray(sequences)||sequences.length<1||sequences.length>20)throw Error('No usable KeyframeSequences found.');
 for(const seq of sequences){
  if(!seq||typeof seq.filename!=='string'||!/^[A-Za-z0-9_ -]{1,60}\.anim$/.test(seq.filename))
   throw Error('Converter returned an invalid filename.');
  const track=await fsp.readFile(path.join(outputDir,seq.filename));
  const info=validateAnim(track);
  if(info.duration<0.05)throw Error('Animation '+seq.filename+' needs at least 0.05 seconds of keyframes.');
 }
 return sequences;
}
const bulkLimiter=rateLimit({
 windowMs:3600000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,
 message:{error:'Hourly bulk conversion limit reached.'}
});
const bulkUpload=multer({
 storage:multer.diskStorage({
  destination(req,file,cb){cb(null,TMP);},
  filename(req,file,cb){cb(null,crypto.randomUUID()+'.tmp');}
 }),
 limits:{fileSize:4*1048576,files:12,fields:0,parts:12},
 fileFilter(req,file,cb){
  if(file.fieldname==='models'&&/\.(rbxm|rbxmx)$/i.test(file.originalname))return cb(null,true);
  cb(new Error('Only Roblox .rbxm or .rbxmx model files are allowed.'));
 }
}).array('models',12);
app.post('/api/rbxm2anim/bulk',bulkLimiter,(req,res)=>{
 bulkUpload(req,res,async error=>{
  const files=req.files||[];
  let directory=null,streamStarted=false;
  let cleanupQueued=false;
  const cleanup=async()=>{
   if(cleanupQueued)return;cleanupQueued=true;
   await Promise.all(files.map(f=>fsp.rm(f.path,{force:true}).catch(()=>{})));
   if(directory)await fsp.rm(directory,{recursive:true,force:true}).catch(()=>{});
  };
  try{
   if(error)throw Error(error.code==='LIMIT_FILE_SIZE'?'Each model must be under 4 MB.':error.message||'Invalid upload.');
   if(!Array.isArray(files)||files.length<1||files.length>12)throw Error('Choose 1 to 12 Roblox models.');
   if(files.reduce((sum,f)=>sum+f.size,0)>32*1048576)throw Error('Maximum combined model size is 32 MB.');
   directory=await fsp.mkdtemp(path.join(TMP,'bulk-'));
   const converted=[];
   const used=new Set();
   for(let i=0;i<files.length;i++){
    const f=files[i];
    if(f.size<32)throw Error('Model '+(i+1)+' is empty or invalid.');
    const output=path.join(directory,'model-'+i);
    let seqs;
    try{seqs=await convertRobloxModel(f.path,output);}
    catch(e){throw Error(f.originalname+': '+e.message);}
    if(converted.length+seqs.length>60)throw Error('Batch exceeds 60 converted animations.');
    for(const seq of seqs){
     const basename=path.parse(f.originalname).name.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,32)||'model';
     const base=(basename+'_'+seq.filename.slice(0,-5).replace(/[^A-Za-z0-9_-]/g,'_')).slice(0,78)||'Animation';
     let filename=base+'.anim',suffix=2;
     while(used.has(filename.toLowerCase()))filename=base.slice(0,72)+'_'+suffix+++'.anim';
     used.add(filename.toLowerCase());
     converted.push({path:path.join(output,seq.filename),name:'UhhhhhhReanim/Content/Anims/'+filename});
    }
   }
   const zip=archiver('zip',{zlib:{level:0}});
   zip.on('error',e=>res.destroy(e));
   res.setHeader('Content-Type','application/zip');
   res.setHeader('Content-Disposition','attachment; filename="MrH_RBXM2ANIM_Bulk.zip"');
   res.setHeader('Cache-Control','no-store');
   res.once('finish',cleanup);
   res.once('close',()=>{if(!res.writableEnded)zip.abort();cleanup();});
   for(const file of converted)zip.file(file.path,{name:file.name});
   zip.pipe(res);streamStarted=true;
   await zip.finalize();
  }catch(e){
   if(!streamStarted)await cleanup();
   if(res.headersSent)return res.destroy(e);
   return fail(res,400,String(e.message||e).slice(0,320));
  }
 });
});

// Create a Uhhhhhh-compatible MOVESET. The original binary .anim files are
// preserved; no arbitrary user-supplied Lua is run server-side).
const movesetLimiter=rateLimit({windowMs:3600000,limit:12,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Hourly moveset creation limit reached.'}});
const movesetFields=[...ROLES.map(name=>({name,maxCount:1})),{name:'music',maxCount:1}];
const movesetUploader=multer({
 storage:multer.diskStorage({
  destination(req,file,cb){cb(null,TMP);},
  filename(req,file,cb){cb(null,crypto.randomUUID()+'.tmp');}
 }),
 limits:{fileSize:20*1048576,files:8,fields:4,parts:12},
 fileFilter(req,file,cb){
  const extension=path.extname(file.originalname).toLowerCase();
  if(ROLES.includes(file.fieldname)&&['.anim','.rbxm','.rbxmx'].includes(extension))return cb(null,true);
  if(file.fieldname==='music'&&extension==='.mp3')return cb(null,true);
  cb(new Error('Only .anim, .rbxm, .rbxmx movement tracks and optional MP3 are supported.'));
 }
}).fields(movesetFields);
app.post('/api/make-moveset',movesetLimiter,(req,res)=>{
 movesetUploader(req,res,async error=>{
  const files=req.files||{};
  let completed=false,conversionDir=null;
  const clean=async()=>{
    await removeTmp(files);
    if(conversionDir)await fsp.rm(conversionDir,{recursive:true,force:true}).catch(()=>{});
  };
  try{
   if(error)throw Error(error.code==='LIMIT_FILE_SIZE'?'File too large.':error.message||'Invalid moveset upload.');
   if(!files.idle?.[0]||!files.walk?.[0])throw Error('Both Idle and Walk files (.anim, .rbxm, or .rbxmx) are required.');
   const tracks={};
   const name=String(req.body?.name||'').trim();
   let total=0;
   for(const role of ROLES){
    const file=files[role]?.[0];
    if(!file)continue;
    const ext=path.extname(file.originalname).toLowerCase();
    const isModel=ext==='.rbxm'||ext==='.rbxmx';
    if(file.size<(isModel?32:8)||file.size>(isModel?4:8)*1048576)
     throw Error(role+' must be '+(isModel?'a model under 4 MB.':'an animation under 8 MB.'));
    total+=file.size;
    let finalPath=file.path;
    if(isModel){
     if(!conversionDir)conversionDir=await fsp.mkdtemp(path.join(TMP,'moveset-'));
     const outputDir=path.join(conversionDir,role);
     let sequences;
     try{sequences=await convertRobloxModel(file.path,outputDir);}
     catch(e){throw Error(role+' ('+file.originalname+'): '+e.message);}
     if(sequences.length!==1)throw Error(role+' model contains '+sequences.length+' animations. Each moveset slot needs exactly one KeyframeSequence. Use RBXM2ANIM for bulk files.');
     finalPath=path.join(outputDir,sequences[0].filename);
    }else{
     const info=validateAnim(await fsp.readFile(file.path));
     if(info.duration<0.05)throw Error(role+' needs at least 0.05 seconds of animation.');
    }
    tracks[role]={...file,path:finalPath};
   }
   const music=files.music?.[0]||null;
   if(music){
    if(music.size<128||music.size>20*1048576)throw Error('MP3 must be between 128 bytes and 20 MB.');
    total+=music.size;
    const handle=await fsp.open(music.path,'r'),header=Buffer.alloc(4);
    try{await handle.read(header,0,4,0);}finally{await handle.close();}
    if(!(header.toString('ascii',0,3)==='ID3'||(header[0]===255&&(header[1]&224)===224)))
      throw Error('Music file is not recognized as MP3.');
   }
   if(total>50*1048576)throw Error('Moveset exceeds 50 MB total.');
   const output=makeMoveset({
    name,roles:tracks,music:!!music,
    description:req.body?.description,
    fade:req.body?.fade,runSpeed:req.body?.runSpeed
   });
   const zip=archiver('zip',{zlib:{level:0}});
   zip.on('error',err=>res.destroy(err));
   res.setHeader('Content-Type','application/zip');
   res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Disposition',
      'attachment; filename="'+output.filename.replace(/\.lua$/,'.zip')+'"');
   res.once('close',()=>{if(!res.writableEnded)zip.abort();});
   for(const role of ROLES){
    if(!tracks[role])continue;
    zip.file(tracks[role].path,{name:'UhhhhhhReanim/Content/Anims/'+output.assets[role]});
   }
   if(music)zip.file(music.path,{name:'UhhhhhhReanim/Content/Sounds/'+output.assets.music});
   zip.append(output.source,{name:'UhhhhhhReanim/Modules/'+output.filename});
   zip.pipe(res);
   completed=true;
   await zip.finalize();
  }catch(err){
   if(!res.headersSent)return fail(res,400,String(err.message||err).slice(0,240));
   res.destroy(err);
  }finally{
   // Disk entries must remain until ZIP streams finish reading.
   if(!completed){await clean();}
   else{
    const cleanup=()=>clean();
    if(res.writableFinished||res.destroyed)await cleanup();
    else res.once('close',cleanup);
   }
  }
 });
});
setupCommunity({app,db,auth,fail,TMP,ROOT});
app.get('/api/animations',(req,res)=>{
 const limit=Math.min(60,Math.max(1,parseInt(req.query.limit,10)||32));
 const offset=Math.min(50000,Math.max(0,parseInt(req.query.offset,10)||0));
 const q=String(req.query.q||'').slice(0,80);
 const where=q?'WHERE a.title LIKE ? OR u.username LIKE ?':'';
 const params=q?['%'+q+'%','%'+q+'%']:[];
 const total=db.prepare('SELECT COUNT(*) AS count FROM animations a JOIN users u ON u.id=a.user_id '+where).get(...params).count;
 const items=db.prepare('SELECT a.*,u.username,u.role,u.avatar_mime,u.avatar_rev,(SELECT COUNT(*) FROM comments c WHERE c.kind=? AND c.item_id=a.id) AS comment_count FROM animations a JOIN users u ON u.id=a.user_id '+where+
  ' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?').all('animations',...params,limit,offset).map(card);
 res.json({items,total});
});
app.post('/api/animations',auth,uploadLimit,(req,res,next)=>{
 uploader(req,res,async(err)=>{
  if(err){await removeTmp(req.files);return fail(res,400,err.code==='LIMIT_FILE_SIZE'?'File too large.':err.message||'Upload failed.');}
  const files=req.files||{},file=key=>Array.isArray(files[key])?files[key][0]:null;
  const id=crypto.randomUUID(),folder=path.join(UPLOADS,id);
  try{
   const title=String(req.body?.title||'').trim();
   const description=String(req.body?.description||'').trim().replace(/\r\n?/g,'\n');
   if([...description].length>500||Buffer.byteLength(description,'utf8')>2000)throw Error('Description must be 500 characters or fewer.');
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
   db.prepare('INSERT INTO animations(id,user_id,title,description,anim_name,mp3_name,lua_name,size_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id,req.user.id,title,description,...names,size,created);
   res.status(201).json({animation:card({id,user_id:req.user.id,username:req.user.username,role:req.user.role,avatar_mime:req.user.avatar_mime,avatar_rev:req.user.avatar_rev,title,description,size_bytes:size,created_at:created})});
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
  if(row.user_id!==req.user.id&&req.user.role!=='owner')return fail(res,403,'Only the uploader or owner can delete this animation.');
  db.transaction(()=>{
   db.prepare('DELETE FROM comments WHERE kind=? AND item_id=?').run('animations',row.id);
   db.prepare('DELETE FROM animations WHERE id=?').run(row.id);
  })();
  await fsp.rm(path.join(UPLOADS,row.id),{force:true,recursive:true});
  res.json({ok:true});
 }catch(e){next(e);}
});
// Serve only the bundled 3D rendering engine, never a third-party script CDN.
app.use('/vendor/three/build',express.static(path.join(__dirname,'node_modules/three/build'),{index:false,dotfiles:'deny',maxAge:'1d'}));
// HTML, JS and CSS are UI/auth critical: never cache old scripts after a deploy.
app.use(express.static(WEB,{
 index:'index.html',dotfiles:'deny',maxAge:0,
 setHeaders(res,filePath){
  if(/\.(?:html|js|css)$/i.test(filePath)){
   res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
   res.setHeader('Pragma','no-cache');
   res.setHeader('Expires','0');
  }
 }
}));
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
