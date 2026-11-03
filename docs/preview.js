/* Mr H Animations / 3D Preview — self-contained R6 pose renderer.
   Reads only validated binary .anim tracks. Never evaluates Lua or third-party JS. */
(()=>{
'use strict';
const byId=id=>document.getElementById(id);
const $=id=>byId(id)||document.createElement('div');
const canvas=byId('preview-stage'); if(!canvas)return;
const ctx=canvas.getContext('2d'); if(!ctx){$('preview-status').textContent='Canvas is not supported by this browser.';return;}

const NAMES=['Torso','Head','Left Arm','Right Arm','Left Leg','Right Leg'];
const NAME_SET=new Set(NAMES);
const SIZES={Torso:[2,2,1],Head:[2,1,1],'Left Arm':[1,2,1],'Right Arm':[1,2,1],'Left Leg':[1,2,1],'Right Leg':[1,2,1]};
const COLORS={Torso:[44,111,181],Head:[241,205,153],'Left Arm':[241,205,153],'Right Arm':[241,205,153],'Left Leg':[51,58,76],'Right Leg':[51,58,76]};
const MAX_BYTES=8000000;

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ID=[1,0,0,0,1,0,0,0,1];
const IDENT={p:[0,0,0],r:ID};
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const scale=(a,v)=>a.map(x=>x*v);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>scale(a,1/Math.max(1e-9,Math.sqrt(dot(a,a))));
const mv=(r,v)=>[r[0]*v[0]+r[1]*v[1]+r[2]*v[2],r[3]*v[0]+r[4]*v[1]+r[5]*v[2],r[6]*v[0]+r[7]*v[1]+r[8]*v[2]];
const tp=r=>[r[0],r[3],r[6],r[1],r[4],r[7],r[2],r[5],r[8]];
const multiply=(a,b)=>{const r=[];for(let row=0;row<3;row++)for(let col=0;col<3;col++)r[row*3+col]=a.r[row*3]*b.r[col]+a.r[row*3+1]*b.r[col+3]+a.r[row*3+2]*b.r[col+6];return {p:add(a.p,mv(a.r,b.p)),r};};
const transform=(m,v)=>add(m.p,mv(m.r,v));

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
function slerp(a,b,t){
 let d=dot(a,b);if(d<0){b=b.map(x=>-x);d=-d;}
 if(d>.9995)return norm(a.map((x,i)=>x+(b[i]-x)*t));
 const th=Math.acos(clamp(d,-1,1)),s=Math.sin(th),w1=Math.sin((1-t)*th)/s,w2=Math.sin(t*th)/s;
 return a.map((x,i)=>x*w1+b[i]*w2);
}

const bounceOut=s=>s<1/2.75?7.5625*s*s:s<2/2.75?7.5625*(s-1.5/2.75)**2+.75:s<2.5/2.75?7.5625*(s-2.25/2.75)**2+.9375:7.5625*(s-2.625/2.75)**2+.984375;
function ease(style,dir,t){
 if(style==='Constant')return dir==='In'?1:dir==='Out'?0:+(t>=.5);
 if(dir!=='In'&&dir!=='Out'&&dir!=='InOut')return t;
 let n=t,out=dir==='Out',phase=0;
 if(dir==='InOut'){phase=t<.5?1:2;n=phase===1?2*t:2*t-1;out=phase===2;}
 let a=n;
 if(style==='Elastic')a=n===0||n===1?n:out?2**(-10*n)*Math.sin((n-.075)*2*Math.PI/.3)+1:-(2**(10*n-10))*Math.sin((n-1.075)*2*Math.PI/.3);
 else if(style==='Bounce'){a=bounceOut(out?n:1-n);if(!out)a=1-a;}
 else if(style==='Cubic'||style==='CubicV2')a=out?1-(1-n)**3:n**3;
 return phase===1?a/2:phase===2?(1+a)/2:a;
}

const FRAME={r:[-1,0,0,0,0,1,0,1,0],l:[0,0,-1,0,1,0,1,0,0],h:[0,0,1,0,1,0,-1,0,0]};
const JOINTS=[
 ['Torso',[0,0,0],[0,0,0],'r'],
 ['Head',[0,1,0],[0,-.5,0],'r'],
 ['Left Arm',[-1,.5,0],[.5,.5,0],'l'],
 ['Right Arm',[1,.5,0],[-.5,.5,0],'h'],
 ['Left Leg',[-1,-1,0],[-.5,1,0],'l'],
 ['Right Leg',[1,-1,0],[.5,1,0],'h']
].map(([name,c0,c1,f])=>{const R=FRAME[f];return {name,c0:{p:c0,r:R},c1inv:{p:scale(mv(tp(R),c1),-1),r:tp(R)}};});

function parseAnim(buffer){
 if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<10||buffer.byteLength>MAX_BYTES)throw Error('Select a valid .anim file under 8 MB.');
 const v=new DataView(buffer),decoder=new TextDecoder('utf-8');let at=0;
 const need=n=>{if(at+n>v.byteLength)throw Error('Truncated animation file.');const o=at;at+=n;return o;};
 const u32=()=>v.getUint32(need(4),true),f32=()=>v.getFloat32(need(4),true);
 const word=()=>{const n=v.getUint16(need(2),true);const o=need(n);return decoder.decode(new Uint8Array(buffer,o,n));};
 const title=word(),count=u32();
 if(count<1||count>(v.byteLength-at)/8)throw Error('Unsupported keyframe count.');
 const raw={};let duration=0,seq=0;
 for(let i=0;i<count;i++){
  let time=f32();if(!Number.isFinite(time)||time<0||time>300)throw Error('Keyframe timestamp outside 0–300 seconds.');
  duration=Math.max(duration,time);
  const total=u32();if(total>(v.byteLength-at)/58)throw Error('Invalid pose count.');
  for(let j=0;j<total;j++){
   const name=word(),weight=f32(),style=word(),dir=word(),vals=[];
   for(let k=0;k<12;k++)vals.push(f32());
   if(!NAME_SET.has(name)||!(weight>0)||!vals.every(Number.isFinite))continue;
   (raw[name]||(raw[name]=[])).push({t:time,seq:seq++,p:vals.slice(0,3),q:qFrom(vals.slice(3)),style,dir});
  }
 }
 const tracks={};
 for(const name of Object.keys(raw)){
  const list=raw[name].sort((a,b)=>a.t-b.t||a.seq-b.seq),out=[];
  for(const k of list)if(!out.length||out[out.length-1].t!==k.t)out.push(k);
  tracks[name]=out;
 }
 const clip={title,count,duration,tracks};
 clip.fit=fitClip(clip);
 return clip;
}
function sampleTrack(track,t){
 if(!track||!track.length)return IDENT;
 let lo=0,hi=track.length-1,idx=-1;
 while(lo<=hi){const mid=(lo+hi)>>1;if(track[mid].t<=t){idx=mid;lo=mid+1;}else hi=mid-1;}
 const a=track[idx]||track[0],b=track[idx+1];
 if(!b||!a||idx<0)return {p:a.p,r:rFrom(a.q)};
 const e=ease(a.style,a.dir,clamp((t-a.t)/Math.max(1e-6,b.t-a.t),0,1));
 return {p:a.p.map((x,i)=>x+(b.p[i]-x)*e),r:rFrom(slerp(a.q,b.q,e))};
}
function rigAt(clip,t){
 const local={},parts={};
 for(const j of JOINTS)local[j.name]=clip?sampleTrack(clip.tracks[j.name],t):IDENT;
 let torso;
 for(const j of JOINTS){
  const base=j.name==='Torso'?IDENT:torso;
  const m=multiply(multiply(multiply(base,j.c0),local[j.name]),j.c1inv);
  if(j.name==='Torso')torso=m;
  parts[j.name]=m;
 }
 return {parts,local};
}
const vertices=(w,h,d)=>{const a=[];for(const x of [-w/2,w/2])for(const y of [-h/2,h/2])for(const z of [-d/2,d/2])a.push([x,y,z]);return a;};
const BOXES=Object.fromEntries(NAMES.map(n=>[n,vertices(...SIZES[n])]));
const DEFAULT_FIT={c:[0,-.5,0],r:3.6,floorY:-3.02};
function fitClip(clip){
 const n=clamp(Math.ceil(clip.duration*30),2,240),pts=[];
 for(let i=0;i<=n;i++){
  const rig=rigAt(clip,clip.duration*i/n);
  for(const name of NAMES)for(const c of BOXES[name])pts.push(transform(rig.parts[name],c));
 }
 const min=[1/0,1/0,1/0],max=[-1/0,-1/0,-1/0];
 for(const p of pts)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
 const c=min.map((m,k)=>(m+max[k])/2);let r2=0;
 for(const p of pts){const d=sub(p,c);r2=Math.max(r2,dot(d,d));}
 return {c,r:Math.max(1.5,Math.sqrt(r2)),floorY:min[1]-.02};
}

const state={clip:null,time:0,speed:1,playing:false,loop:true,angle:205,tilt:15,zoom:1,kind:'animations',loadId:0,listId:0,active:false};
const status=(message,error=false)=>{const el=$('preview-status');el.textContent=message;el.classList.toggle('preview-error',error);};
const format=t=>Math.max(0,t).toFixed(2)+'s';
const setPlayLabel=()=>{$('preview-play').textContent=state.playing?'Pause':'Play';};
{
 const sp=Number(byId('preview-speed')?.value);if(sp>0)state.speed=sp;
 const lp=byId('preview-loop');if(lp)state.loop=lp.checked;
 const ag=byId('preview-angle');if(ag)ag.value=String(state.angle);
 const sv=byId('preview-speed-value');if(sv)sv.textContent=state.speed.toFixed(2)+'×';
}
canvas.style.width='100%';canvas.style.maxWidth='100%';canvas.style.display='block';
canvas.style.touchAction='none';canvas.style.maxHeight='75vh';
if(!canvas.style.aspectRatio)canvas.style.aspectRatio='4 / 3';

const FACES=[[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]];
const LIGHT=norm([-.5,.9,1]);
function draw(){
 const bounds=canvas.getBoundingClientRect();
 const w=Math.round(bounds.width),h=Math.round(bounds.height);
 if(w<2||h<2)return;
 const dpr=Math.min(window.devicePixelRatio||1,2);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,w,h);
 const gradient=ctx.createLinearGradient(0,0,0,h);gradient.addColorStop(0,'#111724');gradient.addColorStop(1,'#07090e');
 ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);

 const fit=state.clip?state.clip.fit:DEFAULT_FIT;
 const a=state.angle*Math.PI/180,e=state.tilt*Math.PI/180;
 const focal=Math.min(w,h)*1.35,half=Math.min(w,h)*.46,R=fit.r*1.08;
 const D=Math.sqrt(R*R+(focal*R/half)**2)*state.zoom;
 const eye=add(fit.c,[D*Math.sin(a)*Math.cos(e),D*Math.sin(e),D*Math.cos(a)*Math.cos(e)]);
 const forward=norm(sub(fit.c,eye)),right=norm(cross(forward,[0,1,0])),up=norm(cross(right,forward));
 const project=v=>{const d=sub(v,eye),z=Math.max(.05,dot(d,forward));return {x:w/2+dot(d,right)*focal/z,y:h/2-dot(d,up)*focal/z,z};};

 const G=Math.max(6,Math.ceil(fit.r*2/2)*2),gx=Math.round(fit.c[0]/2)*2,gz=Math.round(fit.c[2]/2)*2,gy=fit.floorY;
 const corner=(x,z)=>project([x,gy,z]);
 const quad=[corner(gx-G,gz-G),corner(gx+G,gz-G),corner(gx+G,gz+G),corner(gx-G,gz+G)];
 ctx.beginPath();quad.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
 ctx.fillStyle='rgba(43,52,70,.45)';ctx.fill();
 ctx.strokeStyle='rgba(140,160,195,.16)';ctx.lineWidth=1;ctx.beginPath();
 for(let k=-G;k<=G;k+=2){
  const p1=corner(gx+k,gz-G),p2=corner(gx+k,gz+G),p3=corner(gx-G,gz+k),p4=corner(gx+G,gz+k);
  ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.moveTo(p3.x,p3.y);ctx.lineTo(p4.x,p4.y);
 }
 ctx.stroke();

 const rig=rigAt(state.clip,state.time),polys=[];
 for(const name of NAMES){
  const vs=BOXES[name].map(v=>transform(rig.parts[name],v)),color=COLORS[name];
  for(const ids of FACES){
   const p=ids.map(i=>vs[i]),n=norm(cross(sub(p[2],p[0]),sub(p[1],p[0])));
   if(dot(n,sub(eye,p[0]))<=0)continue;
   const depth=p.reduce((s,v)=>s+dot(sub(v,eye),forward),0)/4;
   const lit=clamp(.48+Math.max(0,dot(n,LIGHT))*.52,.4,1);
   polys.push({p:p.map(project),depth,color:color.map(c=>Math.round(c*lit))});
  }
 }
 polys.sort((x,y)=>y.depth-x.depth);
 for(const f of polys){
  ctx.beginPath();f.p.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();
  ctx.fillStyle='rgb('+f.color.join(',')+')';ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,.24)';ctx.lineWidth=1;ctx.stroke();
 }
 ctx.fillStyle='#9ba9bf';ctx.font='11px system-ui, sans-serif';ctx.fillText('R6 / 3D VIEW',18,25);
 window.dispatchEvent(new CustomEvent('mrh-preview-frame',{detail:{angle:state.angle,tilt:state.tilt,pose:rig.local}}));
}

function reset(newClip){
 state.clip=newClip;state.time=0;state.playing=!!newClip&&newClip.duration>0;state.zoom=1;
 setPlayLabel();
 $('preview-scrub').value=0;
 $('preview-track-meta').textContent=newClip?newClip.title+' · '+newClip.count+' keyframes · '+format(newClip.duration):'Select a local track or a community upload.';
 $('preview-timing').textContent='0.00s / '+format(newClip?newClip.duration:0);
 if(newClip)status('Loaded '+newClip.title+' — animation data only; no Lua is run.');
 draw();
}
function setTime(t){
 const d=state.clip?state.clip.duration:0;
 state.time=clamp(t,0,d);
 $('preview-scrub').value=d?String(state.time/d*100):'0';
 $('preview-timing').textContent=format(state.time)+' / '+format(d);
 draw();
}
async function loadBuffer(source,name){
 const id=++state.loadId;status('Reading '+name+'…');
 try{
  const buffer=await source();
  if(id!==state.loadId)return;
  reset(parseAnim(buffer));
 }catch(err){if(id!==state.loadId)return;reset(null);status('Preview failed: '+(err.message||String(err)),true);}
}
function fillTracks(items,onSelect){
 const sel=$('preview-tracks');sel.replaceChildren();
 for(let i=0;i<items.length;i++){
  const opt=document.createElement('option');opt.value=String(i);opt.textContent=items[i].name;sel.append(opt);
 }
 sel.disabled=items.length===0;
 sel.onchange=()=>onSelect(Number(sel.value));
 if(items.length)onSelect(0);
 else{++state.loadId;reset(null);}
}

function openLocal(list){
 const files=[...(list||[])].filter(f=>/\.anim$/i.test(f.name));
 if(!files.length){status('Choose one or more .anim files.',true);return;}
 $('preview-source').value='local';
 fillTracks(files.map(f=>({name:f.name})),i=>loadBuffer(()=>files[i].arrayBuffer(),files[i].name));
}
$('preview-local').addEventListener('change',()=>openLocal($('preview-local').files));
const dropZone=byId('preview-panel')||canvas;
const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
dropZone.addEventListener('dragover',e=>{if(hasFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
dropZone.addEventListener('drop',e=>{if(!hasFiles(e))return;e.preventDefault();openLocal(e.dataTransfer.files);});

async function api(url){
 const resp=await fetch(url,{credentials:'same-origin'});
 if(!resp.ok)throw Error('Server returned '+resp.status+' for '+url.split('?')[0]);
 return resp.json();
}
async function listRemote(){
 const kind=$('preview-kind').value||'animations';state.kind=kind;
 const id=++state.listId;
 $('preview-published').replaceChildren(new Option('Loading uploads…',''));
 status('Loading published '+(kind==='animations'?'dances':'movesets')+'…');
 try{
  const data=await api('/api/'+kind+'?limit=60&offset=0');
  if(id!==state.listId)return;
  const items=Array.isArray(data.items)?data.items:[];
  const select=$('preview-published');select.replaceChildren(new Option('Select a published '+(kind==='animations'?'dance':'moveset'),''));
  for(const item of items)select.add(new Option((item.title||'Untitled')+' — '+(item.username||'Unknown'),item.id));
  status(items.length?'Choose an upload and click Load Tracks.':'No community uploads found.');
 }catch(err){if(id===state.listId)status('Could not load community uploads: '+err.message,true);}
}
$('preview-refresh').addEventListener('click',listRemote);
$('preview-kind').addEventListener('change',listRemote);
$('preview-load').addEventListener('click',async()=>{
 const kind=state.kind,uploadId=$('preview-published').value;
 if(!/^[0-9a-f-]{36}$/i.test(uploadId)){status('Choose an uploaded animation first.',true);return;}
 const id=++state.loadId;status('Loading animation track list…');
 try{
  const manifest=await api('/api/reanimate/'+kind+'/'+encodeURIComponent(uploadId)+'/manifest');
  if(id!==state.loadId)return;
  const files=(manifest.files||[]).filter(f=>/\.anim$/i.test(f.path||'')&&Number.isInteger(f.index)&&f.index>=0&&f.index<=45&&f.sizeBytes>=10&&f.sizeBytes<=MAX_BYTES);
  if(!files.length)throw Error('There are no previewable .anim tracks in this upload.');
  $('preview-source').value='community';
  fillTracks(files.map(f=>({name:f.path.split('/').pop()})),i=>loadBuffer(async()=>{
   const response=await fetch('/api/reanimate/'+kind+'/'+encodeURIComponent(uploadId)+'/file/'+files[i].index,{credentials:'same-origin'});
   if(!response.ok)throw Error('Track unavailable ('+response.status+').');
   const bin=await response.arrayBuffer();
   if(bin.byteLength!==files[i].sizeBytes)throw Error('Animation size does not match its manifest.');
   return bin;
  },files[i].path));
 }catch(err){if(id===state.loadId)status('Cannot open upload: '+err.message,true);}
});

function togglePlay(){
 if(!state.clip)return;
 if(state.time>=state.clip.duration)state.time=0;
 state.playing=!state.playing;setPlayLabel();
}
$('preview-play').addEventListener('click',togglePlay);
$('preview-restart').addEventListener('click',()=>{if(!state.clip)return;setTime(0);state.playing=state.clip.duration>0;setPlayLabel();});
$('preview-scrub').addEventListener('input',e=>{if(state.clip)setTime(state.clip.duration*Number(e.target.value)/100);});
$('preview-speed').addEventListener('input',e=>{state.speed=Number(e.target.value);$('preview-speed-value').textContent=state.speed.toFixed(2)+'×';});
$('preview-loop').addEventListener('change',e=>{state.loop=e.target.checked;});
$('preview-angle').addEventListener('input',e=>{state.angle=Number(e.target.value);draw();});

let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;
 state.angle=((state.angle-(e.clientX-drag.x)*.45)%360+360)%360;
 state.tilt=clamp(state.tilt+(e.clientY-drag.y)*.35,-74,74);
 drag.x=e.clientX;drag.y=e.clientY;
 $('preview-angle').value=String(state.angle);draw();
});
const endDrag=()=>{drag=null;};
canvas.addEventListener('pointerup',endDrag);
canvas.addEventListener('pointercancel',endDrag);
canvas.addEventListener('wheel',e=>{
 if(!e.ctrlKey)return;
 e.preventDefault();
 state.zoom=clamp(state.zoom*Math.exp(e.deltaY*.01),.3,3);draw();
},{passive:false});
window.addEventListener('keydown',e=>{
 if(e.code!=='Space'||!state.active||e.target.closest?.('input,button,textarea,select'))return;
 e.preventDefault();togglePlay();
});

window.addEventListener('mrh-section-change',e=>{
 state.active=e.detail?.tab==='preview';
 if(state.active)draw();else{state.playing=false;setPlayLabel();}
});
if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(state.active)draw();}).observe(canvas);
window.addEventListener('resize',()=>{if(state.active)draw();});

let last=0;
function frame(now){
 const dt=last?Math.min((now-last)/1000,.1):0;last=now;
 if(state.active&&state.playing&&state.clip){
  let t=state.time+dt*state.speed;
  if(t>=state.clip.duration){
   if(state.loop&&state.clip.duration>0)t%=state.clip.duration;
   else{t=state.clip.duration;state.playing=false;setPlayLabel();}
  }
  setTime(t);
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
state.active=!$('preview-panel').hidden;
listRemote();
draw();
})();
