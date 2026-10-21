'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const {spawn}=require('node:child_process');
const WebSocket=require('ws');

const port=23000+Math.floor(Math.random()*20000);
const base='http://127.0.0.1:'+port;
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'mrh-animations-test-'));
const app=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{
 env:{...process.env,PORT:String(port),NODE_ENV:'development',TRUST_PROXY:'false',DATA_DIR:dataDir,OWNER_SETUP_ENABLED:'true',OWNER_SETUP_KEY:'owner-claim-test-key-1234567890-ABCDEFGHIJKLMNOP'},
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

function readZipText(zip,ending){
 // ZIP central directory contains real sizes and offsets, even when streaming
 // local headers use data descriptors and file data is compressed.
 const footer=zip.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 assert.ok(footer>=0,'ZIP end-of-central-directory marker missing');
 const count=zip.readUInt16LE(footer+10);
 let cursor=zip.readUInt32LE(footer+16);
 for(let i=0;i<count;i++){
  assert.equal(zip.readUInt32LE(cursor),0x02014b50,'invalid ZIP central directory');
  const compression=zip.readUInt16LE(cursor+10);
  const compressedSize=zip.readUInt32LE(cursor+20);
  const nameLength=zip.readUInt16LE(cursor+28);
  const extraLength=zip.readUInt16LE(cursor+30);
  const commentLength=zip.readUInt16LE(cursor+32);
  const localOffset=zip.readUInt32LE(cursor+42);
  const name=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
  if(name.endsWith(ending)){
   assert.equal(zip.readUInt32LE(localOffset),0x04034b50);
   const dataStart=localOffset+30+zip.readUInt16LE(localOffset+26)+zip.readUInt16LE(localOffset+28);
   const payload=zip.subarray(dataStart,dataStart+compressedSize);
   const raw=compression===8?zlib.inflateRawSync(payload):payload;
   return raw.toString('utf8');
  }
  cursor+=46+nameLength+extraLength+commentLength;
 }
 throw Error('ZIP entry ending '+ending+' not found');
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
 // Authentication assets must stay current and expose no owner bootstrap form.
 const page=await fetch(base+'/');
 const markup=await page.text();
 assert.ok(page.headers.get('cache-control')?.includes('no-store'),'HTML must not be cached');
 assert.ok(markup.includes('app.js?v=avatar-northkoreaplayer9-20261016'),'auth script must be cache busted');
 assert.ok(markup.includes('id="tab-preview"')&&markup.includes('id="preview-panel"'),'the 3D Preview tab must be present');
 assert.ok(markup.includes('preview.js?v=avatar-northkoreaplayer9-20261016'),'preview renderer must be cache busted');
 assert.ok(markup.includes('preview-rig.js?v=studio-20261021'),'R6 rig renderer must be cache busted');
 const asset=await fetch(base+'/app.js?v=avatar-northkoreaplayer9-20261016');
 const script=await asset.text();
 assert.equal(asset.status,200);
 assert.ok(asset.headers.get('cache-control')?.includes('no-store'),'auth JS must not be cached');
 assert.ok(!script.includes('/owner/claim')&&!script.includes('owner-setup-key')&&!script.includes('Mr_H'),'public authentication script must not disclose bootstrap flow or fixed owner login');
 assert.ok(!markup.includes('data-auth-tab="owner"')&&!markup.includes('id="owner-setup-key"'),'public HTML must not expose owner setup controls');
 assert.ok(!markup.includes('owner-claim-test-key'),'server setup secret must never appear in the page');
 const stylesheet=await fetch(base+'/styles.css?v=avatar-northkoreaplayer9-20261016');
 assert.ok(stylesheet.headers.get('cache-control')?.includes('no-store'),'UI CSS must not be cached');
 const blockedModel=await fetch(base+'/api/roblox-preview/model');
 assert.equal(blockedModel.status,503,'3D mesh must require a server-side Roblox API key');
 const blockedAsset=await fetch(base+'/api/roblox-preview/asset/00000000000000000000000000000000');
 assert.equal(blockedAsset.status,404,'only manifest-approved asset hashes may be proxied');
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
 let manifest=await api('/reanimate/animations/'+id+'/manifest');
 assert.equal(manifest.status,200,JSON.stringify(manifest.body));
 assert.equal(manifest.body.kind,'animations');
 assert.equal(manifest.body.files.length,3);
 assert.deepEqual(manifest.body.files.map(f=>f.path),[
  'UhhhhhhReanim/Content/Anims/Sit.anim',
  'UhhhhhhReanim/Content/Sounds/Sit.mp3',
  'UhhhhhhReanim/Modules/Sit.lua'
 ]);
 for(const [i,file] of manifest.body.files.entries()){
  assert.equal(file.index,i);
  const asset=await api('/reanimate/animations/'+id+'/file/'+i);
  assert.equal(asset.status,200,'dance asset must download');
  const data=Buffer.from(await asset.response.arrayBuffer());
  assert.equal(data.length,file.sizeBytes,'dance file matches manifest size');
  if(i===2)assert.equal(data.toString('utf8'),'local modules = {}\nreturn modules\n');
 }
 const missing=await api('/reanimate/animations/'+id+'/file/3');
 assert.equal(missing.status,404);

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
 assert.equal(r.status,404,'bootstrap endpoint disappears permanently after an owner is claimed');
 r=await api('/owner/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({setupKey:'wrong',password:'AnotherPassword123'})});
 assert.equal(r.status,404,'claimed state does not reveal setup key validity');
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


test('Uhhhhhh Make Animation converts Roblox XML KeyframeSequence to install-ready ZIP',async()=>{
 const xml='<roblox version="4">'+
 '<Item class="KeyframeSequence" referent="1"><Properties><string name="Name">SitTest</string></Properties>'+
 '<Item class="Keyframe" referent="2"><Properties><string name="Name">Keyframe</string><float name="Time">0</float></Properties>'+
 '<Item class="Pose" referent="3"><Properties><string name="Name">Torso</string>'+
 '<float name="Weight">1</float><token name="EasingStyle">0</token>'+
 '<token name="EasingDirection">0</token></Properties></Item></Item>'+
 '<Item class="Keyframe" referent="4"><Properties><string name="Name">Keyframe</string><float name="Time">1</float></Properties>'+
 '<Item class="Pose" referent="5"><Properties><string name="Name">Torso</string><float name="Weight">1</float>'+
 '<token name="EasingStyle">0</token><token name="EasingDirection">0</token></Properties></Item></Item>'+
 '</Item></roblox>';
 const fields=new FormData();
 fields.set('model',new Blob([xml],{type:'application/xml'}),'SitTest.rbxmx');
 fields.set('name','Sit Animation');
 fields.set('loop','true');
 const danceDescription='Wave "Hello"!\nSmooth 🔥';
 fields.set('description',danceDescription);
 const result=await api('/make-animation',{method:'POST',body:fields});
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.match(result.response.headers.get('content-type'),/application\/zip/);
 const bytes=Buffer.from(await result.response.arrayBuffer());
 assert.equal(bytes.readUInt32LE(0),0x04034b50,'download should be a ZIP');
 assert.ok(bytes.includes(Buffer.from('UhhhhhhReanim/Content/Anims/SitTest.anim')),'includes converted track');
 assert.ok(bytes.includes(Buffer.from('UhhhhhhReanim/Modules/')),'includes generated dance module');
 assert.ok(bytes.length>180,'ZIP should contain the animation and module');
 assert.ok(readZipText(bytes,'.lua').includes('elapsed = elapsed + math.max(0, tonumber(dt) or 0)'),'generated dance advances without MP3');
 assert.equal(readZipText(bytes,'.lua').split('\n').find(line=>line.includes('m.Description'))?.trim(),'m.Description = '+JSON.stringify(danceDescription),'dance module description mismatch');
 const bad=new FormData();
 bad.set('model',new Blob(['<roblox><Item class="Part"/></roblox>']),'NotAnimation.rbxmx');
 const rejected=await api('/make-animation',{method:'POST',body:bad});
 assert.equal(rejected.status,400,'models without KeyframeSequence must fail safely');
});

test('Moveset Maker endpoint packages two valid tracks',async()=>{
 const original=makeAnim();
 const n=original.readUInt16LE(0);
 const p=2+n+4;
 const header=Buffer.from(original.subarray(0,p));
 header.writeUInt32LE(2,2+n);
 const frame=original.subarray(p);
 const next=Buffer.from(frame);next.writeFloatLE(1,0);
 const track=Buffer.concat([header,frame,next]);
 const payload=new FormData();
 payload.set('name','Walk Test');
 payload.set('fade','0.20');
 payload.set('runSpeed','16');
 const movesetDescription='Retro "R6" moveset\nCreated by Mr_H';
 payload.set('description',movesetDescription);
 payload.set('idle',new Blob([track]),'idle.anim');
 payload.set('walk',new Blob([track]),'walk.anim');
 const answer=await api('/make-moveset',{method:'POST',body:payload});
 assert.equal(answer.status,200,JSON.stringify(answer.body));
 const zip=Buffer.from(await answer.response.arrayBuffer());
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 for(const entry of ['MRH_Walk_Test_idle.anim','MRH_Walk_Test_walk.anim','MRH_Walk_Test_Moveset.lua'])
  assert.ok(zip.includes(Buffer.from(entry)),'missing '+entry);
 assert.equal(readZipText(zip,'.lua').split('\n').find(line=>line.includes('m.Description'))?.trim(),'m.Description = '+JSON.stringify(movesetDescription),'moveset description mismatch');
 const invalid=new FormData();
 invalid.set('name','Fail Case');invalid.set('fade','0.2');invalid.set('runSpeed','16');
 invalid.set('idle',new Blob([track]),'idle.anim');
 const bad=await api('/make-moveset',{method:'POST',body:invalid});
 assert.equal(bad.status,400);
});


test('Movesets are a separate shared gallery with comments and owner moderation',async()=>{
 const first=makeAnim(),nameBytes=first.readUInt16LE(0),position=2+nameBytes+4;
 const header=Buffer.from(first.subarray(0,position));header.writeUInt32LE(2,2+nameBytes);
 const frame=first.subarray(position),endFrame=Buffer.from(frame);endFrame.writeFloatLE(1,0);
 const anim=Buffer.concat([header,frame,endFrame]);
 const builder=new FormData();
 builder.set('name','Community Test');builder.set('fade','0.20');builder.set('runSpeed','16');
 builder.set('idle',new Blob([anim]),'idle.anim');builder.set('walk',new Blob([anim]),'walk.anim');
 const made=await api('/make-moveset',{method:'POST',body:builder});
 assert.equal(made.status,200,JSON.stringify(made.body));
 const archive=Buffer.from(await made.response.arrayBuffer());
 const info=new FormData();info.set('title','Public Test Moveset');info.set('description','Smooth walk, run and idle for R6.');
 info.set('archive',new Blob([archive],{type:'application/zip'}),'community.zip');
 const posted=await api('/movesets',{method:'POST',body:info});
 assert.equal(posted.status,201,JSON.stringify(posted.body));
 const id=posted.body.moveset.id;
 assert.equal(posted.body.moveset.description,'Smooth walk, run and idle for R6.');
 let r=await api('/movesets');assert.equal(r.status,200);
 assert.ok(r.body.items.some(x=>x.id===id));
 r=await api('/movesets/'+id);assert.equal(r.status,200);
 assert.equal(r.body.item.title,'Public Test Moveset');
 r=await api('/movesets/'+id+'/download');
 assert.equal(r.status,200);
 const received=Buffer.from(await r.response.arrayBuffer());
 assert.equal(received.readUInt32LE(0),0x04034b50);
 assert.ok(received.includes(Buffer.from('MRH_Community_Test_Moveset.lua')));
 const moduleManifest=await api('/reanimate/movesets/'+id+'/manifest');
 assert.equal(moduleManifest.status,200,JSON.stringify(moduleManifest.body));
 assert.equal(moduleManifest.body.kind,'movesets');
 assert.ok(moduleManifest.body.files.length>=3);
 const luaEntry=moduleManifest.body.files.find(file=>file.path.endsWith('.lua'));
 const animEntry=moduleManifest.body.files.find(file=>file.path.endsWith('.anim'));
 assert.ok(luaEntry&&animEntry,'manifest contains moveset Lua and .anim tracks');
 const luaDownload=await api('/reanimate/movesets/'+id+'/file/'+luaEntry.index);
 assert.equal(luaDownload.status,200,JSON.stringify(luaDownload.body));
 const luaContent=await luaDownload.response.text();
 assert.match(luaContent,/m\.ModuleType = "MOVESET"/);
 assert.equal(Buffer.byteLength(luaContent),luaEntry.sizeBytes);
 const animDownload=await api('/reanimate/movesets/'+id+'/file/'+animEntry.index);
 assert.equal(animDownload.status,200,JSON.stringify(animDownload.body));
 assert.equal((await animDownload.response.arrayBuffer()).byteLength,animEntry.sizeBytes);
 const invalidAsset=await api('/reanimate/movesets/'+id+'/file/45');
 assert.equal(invalidAsset.status,400,'unlisted ZIP entries cannot be downloaded');

 const invalidZip=new FormData();
 invalidZip.set('title','Unsafe Package');
 invalidZip.set('archive',new Blob(['not actually zip']),'wrong.zip');
 r=await api('/movesets',{method:'POST',body:invalidZip});
 assert.equal(r.status,400,'reject malformed ZIP content');
 r=await api('/logout',{method:'POST'});assert.equal(r.status,200);
 r=await api('/movesets/'+id+'/comments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'Should fail'})});
 assert.equal(r.status,401,'comments require login');
 const user='Commenter'+crypto.randomBytes(3).toString('hex');
 r=await api('/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:user,password:'CommentPassword123'})});
 assert.equal(r.status,201,JSON.stringify(r.body));
 const commentBody='Very nice animation!\nWorks great.';
 r=await api('/movesets/'+id+'/comments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:commentBody})});
 assert.equal(r.status,201,JSON.stringify(r.body));
 const commentId=r.body.comment.id;
 r=await api('/movesets/'+id+'/comments');
 assert.equal(r.status,200);assert.equal(r.body.total,1);assert.equal(r.body.items[0].body,commentBody);
 r=await api('/movesets/'+id);assert.equal(r.body.item.commentCount,1);
 r=await api('/comments/'+commentId,{method:'DELETE'});
 assert.equal(r.status,200,'comment author may remove their comment');
 r=await api('/movesets/'+id+'/comments');assert.equal(r.body.total,0);
 const danceList=await api('/animations');
 const dance=danceList.body.items.find(x=>x.username==='Mr_H');
 assert.ok(dance,'existing dance upload should still exist');
 r=await api('/animations/'+dance.id+'/comments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:'Dance feedback'})});
 assert.equal(r.status,201);
 const danceCommentId=r.body.comment.id;
 r=await api('/animations/'+dance.id+'/comments');
 assert.equal(r.body.total,1);
 const danceDetail=await api('/animations/'+dance.id);
 assert.equal(danceDetail.status,200);assert.equal(danceDetail.body.item.commentCount,1);
 r=await api('/logout',{method:'POST'});assert.equal(r.status,200);
 r=await api('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'Mr_H',password:'OwnerPassword456'})});
 assert.equal(r.status,200,JSON.stringify(r.body));
 assert.equal(r.body.user.role,'owner');
 r=await api('/comments/'+danceCommentId,{method:'DELETE'});
 assert.equal(r.status,200,'owner can moderate other accounts comments');
 r=await api('/movesets/'+id,{method:'DELETE'});
 assert.equal(r.status,200,'owner can delete public movesets');
 r=await api('/movesets/'+id);assert.equal(r.status,404);
 r=await api('/reanimate/movesets/'+id+'/manifest');
 assert.equal(r.status,404,'deleted uploads disappear from in-game browser');

 r=await api('/movesets/'+id+'/comments');assert.equal(r.status,404);
});


function rawKeyframeModel(name){
 const sequence=(label)=>'<Item class="KeyframeSequence" referent="1"><Properties><string name="Name">'+label+'</string></Properties>'+
 '<Item class="Keyframe" referent="2"><Properties><string name="Name">Keyframe</string><float name="Time">0</float></Properties>'+
 '<Item class="Pose" referent="3"><Properties><string name="Name">Torso</string><float name="Weight">1</float><token name="EasingStyle">0</token><token name="EasingDirection">0</token></Properties></Item></Item>'+
 '<Item class="Keyframe" referent="4"><Properties><string name="Name">Keyframe</string><float name="Time">1</float></Properties>'+
 '<Item class="Pose" referent="5"><Properties><string name="Name">Torso</string><float name="Weight">1</float><token name="EasingStyle">0</token><token name="EasingDirection">0</token></Properties></Item></Item></Item>';
 return '<roblox version="4">'+sequence(name)+'</roblox>';
}

test('Moveset Maker auto-converts RBXM and RBXMX model slots while preserving .anim inputs',async()=>{
 const original=makeAnim();
 const len=original.readUInt16LE(0),start=2+len+4;
 const header=Buffer.from(original.subarray(0,start));header.writeUInt32LE(2,2+len);
 const second=Buffer.from(original.subarray(start));second.writeFloatLE(1,0);
 const anim=Buffer.concat([header,original.subarray(start),second]);
 const models=new FormData();
 models.set('name','Raw Models Test');
 models.set('description','Raw Roblox models converted automatically');
 models.set('fade','0.20');
 models.set('runSpeed','16');
 models.set('idle',new Blob([rawKeyframeModel('RawIdle')],{type:'application/xml'}),'Idle.rbxmx');
 models.set('walk',new Blob([rawKeyframeModel('RawWalk')],{type:'application/octet-stream'}),'Walk.rbxm');
 models.set('run',new Blob([anim]),'Run.anim');
 const response=await api('/make-moveset',{method:'POST',body:models});
 assert.equal(response.status,200,JSON.stringify(response.body));
 const zip=Buffer.from(await response.response.arrayBuffer());
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 for(const filename of ['MRH_Raw_Models_Test_idle.anim','MRH_Raw_Models_Test_walk.anim','MRH_Raw_Models_Test_run.anim','MRH_Raw_Models_Test_Moveset.lua']){
  assert.ok(zip.includes(Buffer.from(filename)),'ZIP missing '+filename);
 }
 assert.ok(readZipText(zip,'.lua').includes('m.ModuleType = "MOVESET"'));
 const invalid=new FormData();
 invalid.set('name','Bad Raw');
 invalid.set('fade','0.2');
 invalid.set('runSpeed','16');
 invalid.set('idle',new Blob(['bad data not a model']),'Invalid.rbxm');
 invalid.set('walk',new Blob([rawKeyframeModel('Walk')]),'Walk.rbxmx');
 const error=await api('/make-moveset',{method:'POST',body:invalid});
 assert.equal(error.status,400,'malformed Roblox model should be rejected');
});

test('RBXM2ANIM tab converts multiple models and returns only anim tracks',async()=>{
 const bulk=new FormData();
 bulk.append('models',new Blob([rawKeyframeModel('TestIdle')]),'Idle.rbxmx');
 bulk.append('models',new Blob([rawKeyframeModel('TestWalk')]),'Walk.rbxm');
 const response=await api('/rbxm2anim/bulk',{method:'POST',body:bulk});
 assert.equal(response.status,200,JSON.stringify(response.body));
 assert.match(response.response.headers.get('content-type'),/application\/zip/);
 const zip=Buffer.from(await response.response.arrayBuffer());
 assert.equal(zip.readUInt32LE(0),0x04034b50);
 for(const name of ['Idle_TestIdle.anim','Walk_TestWalk.anim']){
  assert.ok(zip.includes(Buffer.from('UhhhhhhReanim/Content/Anims/'+name)),'missing '+name);
 }
 assert.ok(!zip.includes(Buffer.from('UhhhhhhReanim/Modules/')),'bulk converter must not create Lua');
 const empty=new FormData();
 const noFiles=await api('/rbxm2anim/bulk',{method:'POST',body:empty});
 assert.equal(noFiles.status,400,'bulk converter must require models');
 const badFile=new FormData();
 badFile.append('models',new Blob(['not a model']),'Corrupt.rbxm');
 const bad=await api('/rbxm2anim/bulk',{method:'POST',body:badFile});
 assert.equal(bad.status,400,'bad Roblox model must fail conversion');
});


test('ephemeral camera capture pairs a browser with a Roblox rig without sharing video',async()=>{
 await waitForServer();
 const page=await fetch(base+'/#camera-motion');
 const markup=await page.text();
 assert.ok(markup.includes('id="tab-mocap"'));
 assert.ok(markup.includes('id="mocap-video"'));
 assert.ok(markup.includes('id="mocap-code"'));
 const tracker=await fetch(base+'/mocap.js?v=cam-v1-20261016');
 assert.equal(tracker.status,200);
 const body=await tracker.text();
 assert.match(body,/getUserMedia/);
 assert.ok(!body.includes("toDataURL("),'camera video must not be uploaded');
 const fresh=await api('/mocap/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(fresh.status,201,JSON.stringify(fresh.body));
 assert.match(fresh.body.code,/^[A-HJ-NP-Z2-9]{10}$/);
 assert.match(fresh.body.publisherKey,/^[a-f0-9]{64}$/);
 const code=fresh.body.code;
 let state=await api('/mocap/session/'+code+'/pose');
 assert.equal(state.status,200);
 assert.equal(state.body.active,false);
 assert.equal(state.body.pose,null);
 assert.equal(state.body.publisherKey,undefined,'private publisher key must not be exposed to pose readers');
 const pose={};
 for(const part of ['head','torso','leftArm','rightArm','leftLeg','rightLeg'])pose[part]=[0.1,0,-0.2];
 let next=await api('/mocap/session/'+code+'/frame',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publisherKey:'0'.repeat(64),pose})});
 assert.equal(next.status,404,'wrong publisher key cannot modify session');
 next=await api('/mocap/session/'+code+'/frame',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publisherKey:fresh.body.publisherKey,pose:{...pose,leftLeg:[100,0,0]}})});
 assert.equal(next.status,400,'out-of-bounds joint rotation must be rejected');
 next=await api('/mocap/session/'+code+'/frame',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publisherKey:fresh.body.publisherKey,pose})});
 assert.equal(next.status,200,JSON.stringify(next.body));
 state=await api('/mocap/session/'+code+'/pose');
 assert.equal(state.status,200);
 assert.equal(state.body.active,true);
 assert.deepEqual(state.body.pose.leftArm,[0.1,0,-0.2]);

 // Protocol v2 uses 6 torso-relative 3x3 matrices instead of Euler triplets.
 await new Promise(resolve=>setTimeout(resolve,105));
 const matrix=[1,0,0,0,1,0,0,0,1];
 const second={v:2,neck:matrix,sh_l:matrix,sh_r:matrix,
  hip_l:matrix,hip_r:matrix,root:matrix,strafe:0,adv:0,span:.48};
 next=await api('/mocap/session/'+code+'/frame',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({publisherKey:fresh.body.publisherKey,pose:second})});
 assert.equal(next.status,200,JSON.stringify(next.body));
 state=await api('/mocap/session/'+code+'/pose');
 assert.equal(state.body.pose.v,2);
 assert.deepEqual(state.body.pose.sh_l,matrix);
 assert.equal(state.body.pose.span,.48);
 await new Promise(resolve=>setTimeout(resolve,105));
 const invalid={...second,sh_l:[10,0,0,0,1,0,0,0,1]};
 next=await api('/mocap/session/'+code+'/frame',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({publisherKey:fresh.body.publisherKey,pose:invalid})});
 assert.equal(next.status,400,'invalid v2 joint matrix must be rejected');

 const ended=await api('/mocap/session/'+code,{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({publisherKey:fresh.body.publisherKey})});
 assert.equal(ended.status,200);
 assert.equal((await api('/mocap/session/'+code+'/pose')).status,404);
});


test('camera WebSocket receives published pose',async()=>{
 await waitForServer();
 const session=await api('/mocap/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 assert.equal(session.status,201);
 const {code,publisherKey}=session.body;
 const ws=new WebSocket(base.replace('http','ws')+'/api/mocap/ws/'+code);
 const received=[];
 ws.on('message',buffer=>received.push(JSON.parse(buffer.toString())));
 await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject);});
 const id=[1,0,0,0,1,0,0,0,1];
 const pose={v:2,neck:id,sh_l:id,sh_r:id,hip_l:id,hip_r:id,root:id};
 const result=await api('/mocap/session/'+code+'/frame',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({publisherKey,pose})});
 assert.equal(result.status,200);
 for(let i=0;i<20&&received.length<2;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.equal(received[0]?.type,'connected');
 assert.equal(received[1]?.type,'pose');
 assert.equal(received[1]?.pose.v,2);
 ws.close();
});
