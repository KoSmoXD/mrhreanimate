/* Mr H Animations / 3D Preview — self-contained R6 pose renderer.
   Reads only validated binary .anim tracks. Never evaluates Lua or third-party JS. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const canvas=$('preview-stage'); if(!canvas)return;
const ctx=canvas.getContext('2d'); if(!ctx){$('preview-status').textContent='Canvas is not supported by this browser.';return;}
const names=['Torso','Head','Left Arm','Right Arm','Left Leg','Right Leg'];
const sizes={Torso:[2,2,1],Head:[2,1,1],'Left Arm':[1,2,1],'Right Arm':[1,2,1],'Left Leg':[1,2,1],'Right Leg':[1,2,1]};
const colors={Torso:[44,111,181],Head:[241,205,153],'Left Arm':[241,205,153],'Right Arm':[241,205,153],'Left Leg':[51,58,76],'Right Leg':[51,58,76]};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ID=[1,0,0,0,1,0,0,0,1];
const eyeT=()=>({p:[0,0,0],r:ID});
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const scale=(a,v)=>a.map(x=>x*v);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>scale(a,1/Math.max(1e-9,Math.sqrt(dot(a,a))));
const mv=(r,v)=>[r[0]*v[0]+r[1]*v[1]+r[2]*v[2],r[3]*v[0]+r[4]*v[1]+r[5]*v[2],r[6]*v[0]+r[7]*v[1]+r[8]*v[2]];
const multiply=(a,b)=>{const r=[];for(let row=0;row<3;row++)for(let col=0;col<3;col++)r[row*3+col]=a.r[row*3]*b.r[col]+a.r[row*3+1]*b.r[col+3]+a.r[row*3+2]*b.r[col+6];return {p:add(a.p,mv(a.r,b.p)),r};};
const tr=(x,y,z)=>({p:[x,y,z],r:ID});
const transform=(m,v)=>add(m.p,mv(m.r,v));
// Quaternion interpolation prevents the limb-shearing caused by matrix element interpolation.
function qFrom(r){
 const trace=r[0]+r[4]+r[8];let w,x,y,z,s;
 if(trace>0){s=Math.sqrt(trace+1)*2;w=s/4;x=(r[7]-r[5])/s;y=(r[2]-r[6])/s;z=(r[3]-r[1])/s;}
 else if(r[0]>r[4]&&r[0]>r[8]){s=Math.sqrt(1+r[0]-r[4]-r[8])*2;w=(r[7]-r[5])/s;x=s/4;y=(r[1]+r[3])/s;z=(r[2]+r[6])/s;}
 else if(r[4]>r[8]){s=Math.sqrt(1+r[4]-r[0]-r[8])*2;w=(r[2]-r[6])/s;x=(r[1]+r[3])/s;y=s/4;z=(r[5]+r[7])/s;}
 else{s=Math.sqrt(1+r[8]-r[0]-r[4])*2;w=(r[3]-r[1])/s;x=(r[2]+r[6])/s;y=(r[5]+r[7])/s;z=s/4;}
 return norm([w,x,y,z]);
}
function rFrom(q){
 const [w,x,y,z]=q;
 return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
}
function mix(a,b,t){
 const aa=a||eyeT(),bb=b||eyeT();let q1=qFrom(aa.r),q2=qFrom(bb.r);
 if(dot(q1,q2)<0)q2=q2.map(x=>-x);
 let q=norm(q1.map((x,i)=>x+(q2[i]-x)*t));
 return {p:aa.p.map((x,i)=>x+(bb.p[i]-x)*t),r:rFrom(q)};
}
function parseAnim(buffer){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<10||buffer.byteLength>8000000)throw Error('Select a valid .anim file under 8 MB.');
 const v=new DataView(buffer), decoder=new TextDecoder('utf-8',{fatal:true});let at=0;
 const need=n=>{if(at+n>v.byteLength)throw Error('Truncated animation file.');let o=at;at+=n;return o;};
 const u16=()=>v.getUint16(need(2),true),u32=()=>v.getUint32(need(4),true);
 const f32=()=>{let n=v.getFloat32(need(4),true);if(!Number.isFinite(n)||Math.abs(n)>1000000)throw Error('Invalid number in animation.');return n;};
 const word=()=>{let n=u16();if(n>512)throw Error('Invalid animation string.');let o=need(n);return decoder.decode(new Uint8Array(buffer,o,n));};
 const title=word(),count=u32();if(count<1||count>1500)throw Error('Unsupported keyframe count.');
 const frames=[];
 for(let i=0;i<count;i++){
  const time=f32();if(time<0||time>300)throw Error('Keyframe timestamp outside 0–300 seconds.');
  const poses={};let total=u32();if(total>100)throw Error('Too many poses in frame.');
  for(let j=0;j<total;j++){
   const name=word(),weight=f32();word();word();
   const vals=Array.from({length:12},f32);
   if(names.includes(name)&&weight>0)poses[name]={p:vals.slice(0,3),r:vals.slice(3)};
  }
  frames.push({time,poses});
 }
 if(at!==v.byteLength)throw Error('Unexpected trailing animation data.');
 frames.sort((a,b)=>a.time-b.time);
 return {title,frames,duration:frames[frames.length-1].time};
}
const state={clip:null,time:0,speed:1,playing:false,loop:true,angle:25,tilt:15,files:[],remote:null,kind:'animations',request:0,active:false};
const status=(message,error=false)=>{let el=$('preview-status');el.textContent=message;el.classList.toggle('preview-error',error);};
const format=t=>Math.max(0,t).toFixed(2)+'s';
function currentPose(){
 const clip=state.clip;if(!clip)return {};
 const f=clip.frames;let t=state.time;
 if(t<=f[0].time)return f[0].poses;
 if(t>=f[f.length-1].time)return f[f.length-1].poses;
 let lo=0,hi=f.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(f[mid].time<=t)lo=mid;else hi=mid;}
 const a=f[lo],b=f[hi],u=clamp((t-a.time)/Math.max(.001,b.time-a.time),0,1),pose={};
 for(const name of names)pose[name]=mix(a.poses[name],b.poses[name],u);
 return pose;
}
const vertices=(w,h,d)=>{let a=[];for(const x of [-w/2,w/2])for(const y of [-h/2,h/2])for(const z of [-d/2,d/2])a.push([x,y,z]);return a;};
// CCW/normal-facing indices for cuboids, with depth sorting.
const FACES=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
const LIGHT=norm([-.5,.9,1]);
function draw(){
 const bounds=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
 const w=Math.max(320,Math.round(bounds.width)),h=Math.max(300,Math.round(bounds.height));
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=w*dpr;canvas.height=h*dpr;}
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,w,h);
 const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#111724');gradient.addColorStop(1,'#07090e');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
 const a=state.angle*Math.PI/180,e=state.tilt*Math.PI/180;
 const eye=[10*Math.sin(a)*Math.cos(e),10*Math.sin(e),10*Math.cos(a)*Math.cos(e)];
 const forward=norm(scale(eye,-1)),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward));
 const focal=Math.min(w*.9,h*1.08);
 const project=v=>{const delta=sub(v,eye),z=dot(delta,forward);return {x:w/2+dot(delta,right)*focal/z,y:h*.51-dot(delta,up)*focal/z,z};};
 const polys=[];
 const cube=(t,size,color,baseAlpha=1)=>{
  const vs=vertices(...size).map(v=>transform(t,v));
  for(const ids of FACES){
   const p=ids.map(i=>vs[i]),n=norm(cross(sub(p[1],p[0]),sub(p[2],p[0])));
   if(dot(n,sub(eye,p[0]))<=0)continue;
   const depth=p.reduce((s,v)=>s+dot(sub(v,eye),forward),0)/4;
   const lit=clamp(.48+Math.max(0,dot(n,LIGHT))*.52,.4,1);
   polys.push({p:p.map(project),depth,color:color.map(n=>Math.round(n*lit)),alpha:baseAlpha});
  }
 };
 const floorY=-3.18;
 cube(tr(0,floorY,0),[7,.14,7],[43,52,70]);
 let pose=currentPose(),torso=pose.Torso||eyeT();
 const boxParts={
  Torso:torso,
  Head:multiply(multiply(multiply(torso,tr(0,1,0)),pose.Head||eyeT()),tr(0,.5,0)),
  'Left Arm':multiply(multiply(multiply(torso,tr(-1,.5,0)),pose['Left Arm']||eyeT()),tr(-.5,-.5,0)),
  'Right Arm':multiply(multiply(multiply(torso,tr(1,.5,0)),pose['Right Arm']||eyeT()),tr(.5,-.5,0)),
  'Left Leg':multiply(multiply(multiply(torso,tr(-.5,-1,0)),pose['Left Leg']||eyeT()),tr(0,-1,0)),
  'Right Leg':multiply(multiply(multiply(torso,tr(.5,-1,0)),pose['Right Leg']||eyeT()),tr(0,-1,0))
 };
 for(const name of names)cube(boxParts[name],sizes[name],colors[name]);
 polys.sort((x,y)=>y.depth-x.depth);
 for(const f of polys){
  ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
  ctx.fillStyle='rgba('+f.color.join(',')+','+f.alpha+')';ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.24)';ctx.lineWidth=1;ctx.stroke();
 }
 // Light grid beyond the stage visually anchors orbit changes.
 ctx.fillStyle='#9ba9bf';ctx.font='11px system-ui, sans-serif';ctx.fillText('R6 / 3D VIEW',18,25);
}
function reset(newClip){
 state.clip=newClip;state.time=0;state.playing=!!newClip&&newClip.duration>0;
 $('preview-play').textContent=state.playing?'Pause':'Play';
 $('preview-scrub').value=0;
 $('preview-track-meta').textContent=newClip?newClip.title+' · '+newClip.frames.length+' keyframes · '+format(newClip.duration):'Select a local track or a community upload.';
 $('preview-timing').textContent='0.00s / '+format(newClip?.duration||0);
 if(newClip)status('Loaded '+newClip.title+' — animation data only; no Lua is run.');
 draw();
}
function setTime(t){
 state.time=clamp(t,0,state.clip?.duration||0);
 $('preview-scrub').value=state.clip?.duration?String(state.time/state.clip.duration*100):'0';
 $('preview-timing').textContent=format(state.time)+' / '+format(state.clip?.duration||0);
 draw();
}
async function loadBuffer(source,name){
 let epoch=++state.request;status('Reading '+name+'…');
 try{
  const buffer=await source();
  if(epoch!==state.request)return;
  const clip=parseAnim(buffer);
  reset(clip);
 }catch(e){if(epoch!==state.request)return;reset(null);status('Preview failed: '+(e.message||String(e)),true);}
}
function fillTracks(items,onSelect){
 const sel=$('preview-tracks');sel.replaceChildren();
 for(let i=0;i<items.length;i++){
  const opt=document.createElement('option');opt.value=String(i);opt.textContent=items[i].name;sel.append(opt);
 }
 sel.disabled=items.length===0;
 sel.onchange=()=>onSelect(Number(sel.value));
 if(items.length)onSelect(0);
 else{++state.request;reset(null);}
}
$('preview-local').addEventListener('change',()=>{
 const files=[...$('preview-local').files||[]].filter(f=>/\.anim$/i.test(f.name));
 state.files=files;
 if(!files.length){status('Choose one or more .anim files.',true);return;}
 $('preview-source').value='local';
 fillTracks(files.map(f=>({name:f.name})),i=>loadBuffer(()=>files[i].arrayBuffer(),files[i].name));
});
async function api(url){
 const resp=await fetch(url,{credentials:'same-origin'});
 if(!resp.ok)throw Error('Server returned '+resp.status+' for '+url.split('?')[0]);
 return resp.json();
}
async function listRemote(){
 const kind=$('preview-kind').value;state.kind=kind;
 const request=++state.request;
 $('preview-published').replaceChildren(new Option('Loading uploads…',''));
 status('Loading published '+(kind==='animations'?'dances':'movesets')+'…');
 try{
  const data=await api('/api/'+kind+'?limit=60&offset=0');
  if(request!==state.request)return;
  const items=Array.isArray(data.items)?data.items:[];state.remote=items;
  const select=$('preview-published');select.replaceChildren(new Option('Select a published '+(kind==='animations'?'dance':'moveset'),''));
  for(const item of items)select.add(new Option((item.title||'Untitled')+' — '+(item.username||'Unknown'),item.id));
  status(items.length?'Choose an upload and click Load Tracks.':'No community uploads found.');
 }catch(e){if(request===state.request)status('Could not load community uploads: '+e.message,true);}
}
$('preview-refresh').addEventListener('click',listRemote);
$('preview-kind').addEventListener('change',listRemote);
$('preview-load').addEventListener('click',async()=>{
 const kind=state.kind,id=$('preview-published').value;
 if(!/^[0-9a-f-]{36}$/i.test(id)){status('Choose an uploaded animation first.',true);return;}
 const request=++state.request;status('Loading animation track list…');
 try{
  const manifest=await api('/api/reanimate/'+kind+'/'+encodeURIComponent(id)+'/manifest');
  if(request!==state.request)return;
  const files=(manifest.files||[]).filter(f=>/\.anim$/i.test(f.path||'')&&Number.isInteger(f.index)&&f.index>=0&&f.index<=45&&f.sizeBytes>=10&&f.sizeBytes<=8000000);
  if(!files.length)throw Error('There are no previewable .anim tracks in this upload.');
  $('preview-source').value='community';
  fillTracks(files.map(f=>({name:f.path.split('/').pop()})),i=>loadBuffer(async()=>{
   const response=await fetch('/api/reanimate/'+kind+'/'+encodeURIComponent(id)+'/file/'+files[i].index,{credentials:'same-origin'});
   if(!response.ok)throw Error('Track unavailable ('+response.status+').');
   const bin=await response.arrayBuffer();
   if(bin.byteLength!==files[i].sizeBytes)throw Error('Animation size does not match its manifest.');
   return bin;
  },files[i].path));
 }catch(e){if(request===state.request)status('Cannot open upload: '+e.message,true);}
});
$('preview-play').addEventListener('click',()=>{
 if(!state.clip)return; if(state.time>=state.clip.duration)state.time=0;
 state.playing=!state.playing;$('preview-play').textContent=state.playing?'Pause':'Play';
});
$('preview-restart').addEventListener('click',()=>{if(!state.clip)return;setTime(0);state.playing=state.clip.duration>0;$('preview-play').textContent=state.playing?'Pause':'Play';});
$('preview-scrub').addEventListener('input',e=>{if(state.clip)setTime(state.clip.duration*Number(e.target.value)/100);});
$('preview-speed').addEventListener('input',e=>{state.speed=Number(e.target.value);$('preview-speed-value').textContent=state.speed.toFixed(2)+'×';});
$('preview-loop').addEventListener('change',e=>{state.loop=e.target.checked;});
$('preview-angle').addEventListener('input',e=>{state.angle=Number(e.target.value);draw();});
let dragging=false,previousX=0;
canvas.addEventListener('pointerdown',e=>{dragging=true;previousX=e.clientX;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!dragging)return;state.angle=(state.angle+(e.clientX-previousX)*.6+360)%360;previousX=e.clientX;$('preview-angle').value=String(state.angle);draw();});
canvas.addEventListener('pointerup',()=>{dragging=false;});
canvas.addEventListener('pointercancel',()=>{dragging=false;});
canvas.addEventListener('wheel',e=>{e.preventDefault();state.tilt=clamp(state.tilt-e.deltaY*.03,-25,65);draw();},{passive:false});
window.addEventListener('mrh-section-change',e=>{state.active=e.detail?.tab==='preview';if(state.active)draw();else{state.playing=false;$('preview-play').textContent='Play';}});
let last=0;
function frame(now){
 const dt=last?Math.min((now-last)/1000,.1):0;last=now;
 if(state.active&&state.playing&&state.clip){
  let t=state.time+dt*state.speed;
  if(t>=state.clip.duration){if(state.loop&&state.clip.duration>0)t%=state.clip.duration;else{t=state.clip.duration;state.playing=false;$('preview-play').textContent='Play';}}
  setTime(t);
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
listRemote();
draw();
})();
