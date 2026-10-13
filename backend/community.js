'use strict';
const crypto=require('node:crypto'),path=require('node:path'),fs=require('node:fs'),fsp=require('node:fs/promises');
const multer=require('multer'),rateLimit=require('express-rate-limit');
const {promisify}=require('node:util'),{execFile}=require('node:child_process');
const run=promisify(execFile);
module.exports=function community({app,db,auth,fail,TMP,ROOT}){
 const MOVES=path.join(ROOT,'movesets');fs.mkdirSync(MOVES,{recursive:true});
 db.exec([
 "CREATE TABLE IF NOT EXISTS movesets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',size_bytes INTEGER NOT NULL,created_at INTEGER NOT NULL);",
 "CREATE INDEX IF NOT EXISTS moveset_created ON movesets(created_at DESC);",
 "CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('animations','movesets')),item_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);",
 "CREATE INDEX IF NOT EXISTS comments_item ON comments(kind,item_id,created_at DESC);"
 ].join('\n'));
 if(!db.prepare('PRAGMA table_info(animations)').all().some(x=>x.name==='description'))
  db.exec("ALTER TABLE animations ADD COLUMN description TEXT NOT NULL DEFAULT ''");
 function clean(value,max,label,required=false){
  if(value==null)value='';
  if(typeof value!=='string')throw Error(label+' must be text.');
  value=value.trim().replace(/\r\n?/g,'\n');
  if([...value].length>max||Buffer.byteLength(value,'utf8')>max*4)throw Error(label+' is limited to '+max+' characters.');
  if(required&&!value)throw Error(label+' cannot be blank.');
  return value;
 }
 const get=(kind,id)=>['animations','movesets'].includes(kind)?
  db.prepare('SELECT id,user_id FROM '+kind+' WHERE id=?').get(id):null;
 const select=kind=>"SELECT a.*,u.username,u.role,u.avatar_mime,u.avatar_rev,(SELECT COUNT(*) FROM comments c WHERE c.kind='"+kind+"' AND c.item_id=a.id) AS comment_count FROM "+kind+" a JOIN users u ON u.id=a.user_id";
 const item=x=>({id:x.id,userId:x.user_id,title:x.title,description:x.description||'',sizeBytes:x.size_bytes,commentCount:x.comment_count||0,createdAt:new Date(x.created_at).toISOString(),username:x.username,role:x.role==='owner'?'owner':'user',avatarUrl:x.avatar_mime?'/api/users/'+x.user_id+'/avatar?v='+(x.avatar_rev||0):null});
 app.get('/api/movesets',(req,res)=>{
  const limit=Math.min(50,Math.max(1,parseInt(req.query.limit,10)||32)),offset=Math.min(50000,Math.max(0,parseInt(req.query.offset,10)||0)),q=String(req.query.q||'').slice(0,80);
  const where=q?' WHERE a.title LIKE ? OR a.description LIKE ? OR u.username LIKE ?':'';
  const args=q?Array(3).fill('%'+q+'%'):[];
  const total=db.prepare('SELECT COUNT(*) AS n FROM movesets a JOIN users u ON u.id=a.user_id'+where).get(...args).n;
  res.json({items:db.prepare(select('movesets')+where+' ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?').all(...args,limit,offset).map(item),total});
 });
 app.get('/api/:kind/:id',(req,res,next)=>{
  if(!['animations','movesets'].includes(req.params.kind))return next();
  const row=db.prepare(select(req.params.kind)+' WHERE a.id=?').get(req.params.id);
  if(!row)return fail(res,404,'Upload not found.');
  res.json({item:item(row)});
 });
 const uploadLimit=rateLimit({windowMs:3600000,limit:10,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Hourly moveset upload limit reached.'}});
 const zipUpload=multer({
  storage:multer.diskStorage({destination(req,file,cb){cb(null,TMP);},filename(req,file,cb){cb(null,crypto.randomUUID()+'.tmp');}}),
  limits:{fileSize:50*1048576,files:1,fields:2,parts:3},
  fileFilter(req,file,cb){
   if(file.fieldname!=='archive'||path.extname(file.originalname).toLowerCase()!=='.zip')return cb(new Error('Choose one moveset ZIP.'));
   cb(null,true);
  }
 }).single('archive');
 app.post('/api/movesets',auth,uploadLimit,(req,res)=>{
  zipUpload(req,res,async err=>{
   const temp=req.file?.path;
   try{
    if(err)throw Error(err.code==='LIMIT_FILE_SIZE'?'ZIP must be under 50 MB.':err.message||'Invalid file.');
    if(!req.file?.size)throw Error('Choose a moveset ZIP.');
    const title=clean(req.body?.title,80,'Title',true),description=clean(req.body?.description,500,'Description');
    if([...title].length<2)throw Error('Title must contain at least 2 characters.');
    try{
     await run('python3',[path.join(__dirname,'tools/validate_moveset_zip.py'),temp],{timeout:12000,maxBuffer:8192,windowsHide:true});
    }catch(error){throw Error(String(error.stderr||'Invalid Uhhhhhh moveset ZIP.').trim().slice(0,230));}
    const id=crypto.randomUUID(),dest=path.join(MOVES,id+'.zip');
    await fsp.rename(temp,dest);
    try{
     const now=Date.now();
     db.prepare('INSERT INTO movesets(id,user_id,title,description,size_bytes,created_at) VALUES(?,?,?,?,?,?)').run(id,req.user.id,title,description,req.file.size,now);
     res.status(201).json({moveset:item({id,user_id:req.user.id,title,description,size_bytes:req.file.size,created_at:now,username:req.user.username,role:req.user.role,avatar_mime:req.user.avatar_mime,avatar_rev:req.user.avatar_rev})});
    }catch(error){await fsp.rm(dest,{force:true});throw error;}
   }catch(error){return fail(res,400,String(error.message||error).slice(0,230));}
   finally{if(temp)await fsp.rm(temp,{force:true}).catch(()=>{});}
  });
 });
 app.get('/api/movesets/:id/download',(req,res,next)=>{
  const row=get('movesets',req.params.id);if(!row)return fail(res,404,'Moveset not found.');
  const file=path.join(MOVES,row.id+'.zip');if(!fs.existsSync(file))return fail(res,410,'ZIP unavailable.');
  res.setHeader('Content-Type','application/zip');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Disposition','attachment; filename="MrH_Moveset_'+row.id+'.zip"');
  res.sendFile(file,err=>{if(err&&!res.headersSent)next(err);});
 });
 app.delete('/api/movesets/:id',auth,async(req,res,next)=>{
  try{
   const row=get('movesets',req.params.id);if(!row)return fail(res,404,'Moveset not found.');
   if(row.user_id!==req.user.id&&req.user.role!=='owner')return fail(res,403,'Only uploader or owner can delete movesets.');
   db.transaction(()=>{
    db.prepare('DELETE FROM comments WHERE kind=? AND item_id=?').run('movesets',row.id);
    db.prepare('DELETE FROM movesets WHERE id=?').run(row.id);
   })();
   await fsp.rm(path.join(MOVES,row.id+'.zip'),{force:true});
   res.json({ok:true});
  }catch(error){next(error);}
 });
 const commentLimit=rateLimit({windowMs:15*60000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Comment limit reached. Try later.'}});
 const comment=x=>({id:x.id,userId:x.user_id,username:x.username,role:x.role==='owner'?'owner':'user',avatarUrl:x.avatar_mime?'/api/users/'+x.user_id+'/avatar?v='+(x.avatar_rev||0):null,body:x.body,createdAt:new Date(x.created_at).toISOString()});
 app.get('/api/:kind/:id/comments',(req,res,next)=>{
  const {kind,id}=req.params;if(!['animations','movesets'].includes(kind))return next();
  if(!get(kind,id))return fail(res,404,'Upload not found.');
  const offset=Math.min(10000,Math.max(0,parseInt(req.query.offset,10)||0));
  const total=db.prepare('SELECT COUNT(*) AS n FROM comments WHERE kind=? AND item_id=?').get(kind,id).n;
  const items=db.prepare('SELECT c.*,u.username,u.role,u.avatar_mime,u.avatar_rev FROM comments c JOIN users u ON u.id=c.user_id WHERE c.kind=? AND c.item_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT 40 OFFSET ?').all(kind,id,offset).map(comment);
  res.json({items,total});
 });
 app.post('/api/:kind/:id/comments',auth,commentLimit,(req,res,next)=>{
  const {kind,id}=req.params;if(!['animations','movesets'].includes(kind))return next();
  if(!get(kind,id))return fail(res,404,'Upload not found.');
  let body;try{body=clean(req.body?.body,1000,'Comment',true);}catch(e){return fail(res,400,e.message);}
  const newId=crypto.randomUUID(),now=Date.now();
  db.prepare('INSERT INTO comments(id,user_id,kind,item_id,body,created_at) VALUES(?,?,?,?,?,?)').run(newId,req.user.id,kind,id,body,now);
  res.status(201).json({comment:comment({id:newId,user_id:req.user.id,role:req.user.role,username:req.user.username,avatar_mime:req.user.avatar_mime,avatar_rev:req.user.avatar_rev,body,created_at:now})});
 });
 app.delete('/api/comments/:id',auth,(req,res)=>{
  const row=db.prepare('SELECT id,user_id FROM comments WHERE id=?').get(req.params.id);
  if(!row)return fail(res,404,'Comment not found.');
  if(row.user_id!==req.user.id&&req.user.role!=='owner')return fail(res,403,'Only author or owner can delete comments.');
  db.prepare('DELETE FROM comments WHERE id=?').run(row.id);
  res.json({ok:true});
 });
 return {MOVES};
};