'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

const port=23000+Math.floor(Math.random()*20000);
const base='http://127.0.0.1:'+port;
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mrh-animations-test-'));
const app=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{
 env:{...process.env,PORT:String(port),NODE_ENV:'development',TRUST_PROXY:'false',DATA_DIR:dataDir,OWNER_SETUP_KEY:'owner-claim-test-key-1234567890-ABCDEFGHIJKLMNOP'},
 stdio:['ignore','pipe','pipe']
});
let logs='';
app.stdout.on('data',b=>logs+=b.toString());
app.stderr.on('data',b=>logs+=b.toString());
test.after(async()=>{
 app.kill('SIGTERM');
 await new Promise(resolve=>{if(app.exitCode!==null)return resolve();app.once('exit',resolve);setTimeout(resolve,3000);});
 fs.rmSync(dataDir,{force:true,recursive:true});
});
async function waitForServer(){
 for(let i=0;i<70;i++){
  if(app.exitCode!==null)throw Error('Backend exited unexpectedly: '+logs);
  try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,120));
 }
 throw Error('Server failed to start: '+logs);
}
let cookie='';
async function api(uri,options={}){
 const headers={...(options.headers||{})};
 if(cookie)headers.cookie=cookie;
 const r=await fetch(base+'/api'+uri,{...options,headers});
 const session=r.headers.get('set-cookie');
 if(session){
  const entry=session.split(';')[0];
  cookie=entry.startsWith('mrh_sid=')?entry:'';
 }
 let json=null;
 if((r.headers.get('content-type')||'').includes('json'))json=await r.json();
 return {status:r.status,body:json,response:r};
}
function makeAnim(){
 const name=Buffer.from('Sit Test'),bone=Buffer.from('Torso'),style=Buffer.from('Linear'),dir=Buffer.from('In');
 const parts=[];
 const s=value=>{const b=Buffer.from(value);const h=Buffer.alloc(2);h.writeUInt16LE(b.length);parts.push(h,b);};
 const u=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);parts.push(b);};
 const f=n=>{const b=Buffer.alloc(4);b.writeFloatLE(n);parts.push(b);};
 s(name);u(1);f(0);u(1);s(bone);f(1);s(style);s(dir);
 for(const v of [0,0,0,1,0,0,0,1,0,0,0,1])f(v);
 return Buffer.concat(parts);
}
test('public gallery, registration, authenticated upload, ZIP download and account settings',async()=>{
 await waitForServer();
 // Prevent a stale signup script from being paired with the newer Owner setup tab.
 const page=await fetch(base+'/');
 const markup=await page.text();
 assert.ok(page.headers.get('cache-control')?.includes('no-store'),'HTML must not be cached');
 assert.ok(markup.includes('app.js?v=owner-setup-cachefix-20261013'),'auth script must be cache busted');
 const asset=await fetch(base+'/app.js?v=owner-setup-cachefix-20261013');
 const script=await asset.text();
 assert.equal(asset.status,200);
 assert.ok(asset.headers.get('cache-control')?.includes('no-store'),'auth JS must not be cached');
 assert.ok(script.includes("'/owner/claim'"),'owner setup must route to special owner endpoint');
 const stylesheet=await fetch(base+'/styles.css?v=owner-setup-cachefix-20261013');
 assert.ok(stylesheet.headers.get('cache-control')?.includes('no-store'),'UI CSS must not be cached');
 const guest=await api('/animations');
 assert.equal(guest.status,200);assert.deepEqual(guest.body.items,[]);
 const uname='User'+crypto.randomBytes(4).toString('hex');
 let r=await api('/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:uname,password:'SecretPassphrase123'})});
 assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(r.body.user.username,uname);
 r=await api('/me');assert.equal(r.status,200);
 const pack=new FormData();
 pack.set('title','Sit animation');
 pack.set('anim',new Blob([makeAnim()],{type:'application/octet-stream'}),'Sit.anim');
 pack.set('mp3',new Blob([Uint8Array.from([73,68,51,3,0,0,0,0])],{type:'audio/mpeg'}),'Sit.mp3');
 pack.set('lua',new Blob(['local modules = {}\nreturn modules\n'],{type:'text/plain'}),'Sit.lua');
 const uploaded=await api('/animations',{method:'POST',body:pack});
 assert.equal(uploaded.status,201,JSON.stringify(uploaded.body));
 const id=uploaded.body.animation.id;
 r=await api('/animations');assert.equal(r.status,200);assert.equal(r.body.items.length,1);
 assert.equal(r.body.items[0].username,uname);
 const zip=await api('/animations/'+id+'/download');
 assert.equal(zip.status,200);
 const binary=Buffer.from(await zip.response.arrayBuffer());
 assert.equal(binary.readUInt32LE(0),0x04034b50,'ZIP has expected local header signature');
 r=await api('/me',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({username:uname+'2',currentPassword:'SecretPassphrase123',newPassword:'StrongerPassphrase456'})});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.user.username,uname+'2');
 r=await api('/animations');assert.equal(r.body.items[0].username,uname+'2');
 r=await api('/animations/'+id,{method:'DELETE'});assert.equal(r.status,200);
 r=await api('/animations');assert.equal(r.body.items.length,0);
 r=await api('/me',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({password:'StrongerPassphrase456'})});
 assert.equal(r.status,200);
 r=await api('/me');assert.equal(r.status,401);
});


test('owner claim is reserved and one-time; avatar upload and owner moderation work',async()=>{
 let r=await api('/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'Mr_H',password:'StrongPassword123'})});
 assert.equal(r.status,403,'ordinary registration cannot impersonate the owner');
 const uname='Creator'+crypto.randomBytes(4).toString('hex');
 r=await api('/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:uname,password:'RegularPassword123'})});
 assert.equal(r.status,201,JSON.stringify(r.body));
 r=await api('/me',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({username:'Mr_H',currentPassword:'RegularPassword123'})});
 assert.equal(r.status,403,'regular users cannot rename themselves to owner');
 const animation=new FormData();
 animation.set('title','Moderation demo');
 animation.set('anim',new Blob([makeAnim()]),'Moderation.anim');
 animation.set('mp3',new Blob([Uint8Array.from([73,68,51,3,0,0,0,0])]),'Moderation.mp3');
 animation.set('lua',new Blob(['return {}']),'Moderation.lua');
 r=await api('/animations',{method:'POST',body:animation});
 assert.equal(r.status,201,JSON.stringify(r.body));
 const uploadedId=r.body.animation.id;
 r=await api('/logout',{method:'POST'});assert.equal(r.status,200);
 r=await api('/owner/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupKey:'incorrect-owner-claim',password:'OwnerPassword456'})});
 assert.equal(r.status,403,'wrong setup key cannot create an owner');
 r=await api('/owner/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupKey:'owner-claim-test-key-1234567890-ABCDEFGHIJKLMNOP',password:'OwnerPassword456'})});
 assert.equal(r.status,201,JSON.stringify(r.body));
 assert.equal(r.body.user.username,'Mr_H');
 assert.equal(r.body.user.role,'owner');
 r=await api('/owner/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupKey:'owner-claim-test-key-1234567890-ABCDEFGHIJKLMNOP',password:'AnotherPassword123'})});
 assert.equal(r.status,409,'owner can only be claimed once');
 r=await api('/me',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({username:'OtherAdmin',currentPassword:'OwnerPassword456'})});
 assert.equal(r.status,403,'verified owner username remains locked');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
 const photo=new FormData();
 photo.set('avatar',new Blob([png],{type:'image/png'}),'avatar.png');
 r=await api('/me/avatar',{method:'PUT',body:photo});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.match(r.body.user.avatarUrl,/^\/api\/users\//);
 const ownerId=r.body.user.id;
 const image=await api('/users/'+ownerId+'/avatar');
 assert.equal(image.status,200);
 assert.ok(image.response.headers.get('content-type').includes('image/png'));
 const ownerFile=new FormData();
 ownerFile.set('title','Official Mr_H dance');
 ownerFile.set('anim',new Blob([makeAnim()]),'Official.anim');
 ownerFile.set('mp3',new Blob([Uint8Array.from([73,68,51,3,0,0,0,0])]),'Official.mp3');
 ownerFile.set('lua',new Blob(['return {}']),'Official.lua');
 r=await api('/animations',{method:'POST',body:ownerFile});
 assert.equal(r.status,201,JSON.stringify(r.body));
 r=await api('/animations');assert.equal(r.status,200);
 const official=r.body.items.find(item=>item.username==='Mr_H');
 assert.equal(official.role,'owner');
 assert.ok(official.avatarUrl,'avatar should appear in animation gallery');
 r=await api('/animations/'+uploadedId,{method:'DELETE'});
 assert.equal(r.status,200,'owner can delete a different uploader animation');
 r=await api('/me/avatar',{method:'DELETE'});assert.equal(r.status,200);
 assert.equal(r.body.user.avatarUrl,null);
 r=await api('/me',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({password:'OwnerPassword456'})});
 assert.equal(r.status,403,'verified owner account cannot be deleted');
});
