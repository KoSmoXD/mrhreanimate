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
 env:{...process.env,PORT:String(port),NODE_ENV:'development',TRUST_PROXY:'false',DATA_DIR:dataDir},
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
