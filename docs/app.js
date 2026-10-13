/* Mr H Animation Studio — native Uhhhhhh binary .anim player/editor.
 * Zero runtime dependencies. Files remain on the visitor's device.
 * Binary layout matches Mr H AnimLib.Track.frombuffer:
 * u16 name bytes; u32 frames; per frame f32 time + u32 poses;
 * per pose u16 name, f32 weight, u16 easing style, u16 direction,
 * then 12 little-endian f32 CFrame values.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const bones = ['Torso', 'Head', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg'];
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const MAX_BYTES = 8000000, MAX_FRAMES = 1500, MAX_POSES = 100;
  const storeName = 'mrh-animation-studio-v1';
  const DB_NAME = 'mrh-anim-browser-library';
  const IDENTITY = [0,0,0,1,0,0,0,1,0,0,0,1];
  const state = {
    clips:[], activeId:null, frameIndex:0, bone:'Torso',
    time:0, playing:false, lastTick:0, speed:1, loop:true,
    yaw:0.59, pitch:0.23, zoom:1, grid:true, db:null,
    hitboxes:[], interacting:false, pointerStart:null, error:''
  };
  let resizeObserver = null;

  function toast(message, error) {
    const host = $('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.textContent = String(message);
    host.appendChild(el);
    setTimeout(() => el.remove(), 3900);
  }
  function status(message) {
    $('status-line').textContent = message;
  }
  function clip() { return state.clips.find(c => c.id === state.activeId) || null; }
  function newId() {
    return (globalThis.crypto && crypto.randomUUID)
      ? crypto.randomUUID() : 'mrh-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }
  function copyMatrix(m) { return (m || IDENTITY).slice(); }
  function cleanFilename(v) {
    const text = String(v || 'Untitled').replace(/\.anim$/i, '').replace(/[^a-zA-Z0-9_\- ]/g,'_').trim().slice(0,55);
    return (text || 'Untitled') + '.anim';
  }
  function fmt(t) {
    t = Math.max(0, Number(t) || 0);
    const m = Math.floor(t / 60), s = Math.floor(t % 60), f = Math.floor((t % 1) * 100);
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0') + '.' + String(f).padStart(2,'0');
  }
  const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
  const finite = (x,limit) => Number.isFinite(x) && Math.abs(x)<(limit || 1000000);
  const blankPose = (name, matrix) => ({name:name, weight:1, easingStyle:'Linear', easingDirection:'In', matrix:copyMatrix(matrix)});
  function deepFrames(frames) {
    return frames.map(f=>({time:f.time,poses:f.poses.map(p=>({
      name:p.name, weight:p.weight, easingStyle:p.easingStyle,
      easingDirection:p.easingDirection,matrix:copyMatrix(p.matrix)
    }))}));
  }
  function parseAnim(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 6 || buffer.byteLength > MAX_BYTES) throw new Error('Invalid .anim file size (maximum 8 MB).');
    const dv = new DataView(buffer);
    let pos = 0;
    function need(n) { if (pos+n > dv.byteLength) throw new Error('The .anim file is truncated.'); }
    function u16() { need(2); const n=dv.getUint16(pos,true);pos+=2;return n; }
    function u32() { need(4);const n=dv.getUint32(pos,true);pos+=4;return n; }
    function f32() {
      need(4);const n=dv.getFloat32(pos,true);pos+=4;
      if (!finite(n)) throw new Error('Invalid CFrame or timing value.');
      return n;
    }
    function str() {
      const n=u16(); if(n>512) throw new Error('Animation string is too long.');
      need(n); const s=decoder.decode(new Uint8Array(buffer,pos,n)); pos+=n; return s;
    }
    const name=str(), count=u32();
    if(count<1 || count>MAX_FRAMES) throw new Error('Unsupported keyframe count (maximum 1500).');
    const frames=[];
    for(let j=0;j<count;j++) {
      const time=f32();
      if(time<0 || time>300) throw new Error('Animation duration must be within 0–300 seconds.');
      const poseCount=u32();
      if(poseCount>MAX_POSES) throw new Error('Too many poses in a keyframe.');
      const poses=[];
      for(let k=0;k<poseCount;k++){
        const bone=str(), weight=f32(), easingStyle=str(), easingDirection=str(), matrix=[];
        for(let m=0;m<12;m++)matrix.push(f32());
        poses.push({name:bone,weight,easingStyle,easingDirection,matrix});
      }
      frames.push({time,poses});
    }
    frames.sort((a,b)=>a.time-b.time);
    return {name:name || 'Untitled Animation', frames, duration:frames[frames.length-1].time};
  }
  function exportAnim(c) {
    const name=encoder.encode(c.name || 'Untitled Animation');
    if(name.length>512)throw new Error('Animation name is too long.');
    const makeStr=s=>{
      const v=encoder.encode(String(s||''));
      if(v.length>512) throw new Error('Pose string exceeds 512 bytes.');
      return v;
    };
    const cooked=c.frames.map(frame=>({
      time:frame.time,
      poses:frame.poses.map(p=>({
        name:makeStr(p.name),style:makeStr(p.easingStyle),direction:makeStr(p.easingDirection),
        weight:p.weight,matrix:p.matrix
      }))
    }));
    let bytes=2+name.length+4;
    for(const f of cooked){
      bytes+=8;
      for(const p of f.poses)bytes+=2+p.name.length+4+2+p.style.length+2+p.direction.length+48;
    }
    if(bytes>MAX_BYTES)throw new Error('Export exceeds the 8 MB safety limit.');
    const data=new ArrayBuffer(bytes),view=new DataView(data);
    let offset=0;
    function w16(v){view.setUint16(offset,v,true);offset+=2;}
    function w32(v){view.setUint32(offset,v,true);offset+=4;}
    function wf(v) {
      if(!finite(v))throw new Error('Non-finite value cannot be exported.');
      view.setFloat32(offset,v,true);offset+=4;
    }
    function ws(arr){w16(arr.length);new Uint8Array(data,offset,arr.length).set(arr);offset+=arr.length;}
    ws(name);w32(cooked.length);
    for(const f of cooked){
      wf(f.time);w32(f.poses.length);
      for(const p of f.poses){
        if(!Array.isArray(p.matrix)||p.matrix.length!==12)throw new Error('Invalid CFrame data.');
        ws(p.name);wf(p.weight);ws(p.style);ws(p.direction);
        for(const value of p.matrix)wf(value);
      }
    }
    if(offset!==bytes)throw new Error('Binary writer size mismatch.');
    return data;
  }
  function rotationXYZ(rx,ry,rz) {
    const x=rx*Math.PI/180,y=ry*Math.PI/180,z=rz*Math.PI/180;
    const cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return [
      cy*cz, -cy*sz, sy,
      sx*sy*cz+cx*sz, -sx*sy*sz+cx*cz, -sx*cy,
      -cx*sy*cz+sx*sz, cx*sy*sz+sx*cz, cx*cy
    ];
  }
  function matrixFromControls(v) {
    return [v[0],v[1],v[2],...rotationXYZ(v[3],v[4],v[5])];
  }
  function controlsFromMatrix(m) {
    const ry=Math.asin(clamp(m[5],-1,1));
    let rx,rz;
    if(Math.abs(Math.cos(ry))>0.000001){
      rx=Math.atan2(-m[8],m[11]);rz=Math.atan2(-m[4],m[3]);
    } else {rx=Math.atan2(m[10],m[7]);rz=0;}
    const deg=180/Math.PI;
    return [m[0],m[1],m[2],rx*deg,ry*deg,rz*deg];
  }
  // Rotations use quaternions so interpolating keyframes does not deform limbs.
  function quatFromMat(m) {
    const a=m[3],b=m[4],c=m[5],d=m[6],e=m[7],f=m[8],g=m[9],h=m[10],i=m[11];
    const trace=a+e+i;let x,y,z,w;
    if(trace>0){
      const s=Math.sqrt(trace+1)*2;w=.25*s;x=(h-f)/s;y=(c-g)/s;z=(d-b)/s;
    }else if(a>e && a>i){
      const s=Math.sqrt(1+a-e-i)*2;w=(h-f)/s;x=.25*s;y=(b+d)/s;z=(c+g)/s;
    }else if(e>i){
      const s=Math.sqrt(1+e-a-i)*2;w=(c-g)/s;x=(b+d)/s;y=.25*s;z=(f+h)/s;
    }else {
      const s=Math.sqrt(1+i-a-e)*2;w=(d-b)/s;x=(c+g)/s;y=(f+h)/s;z=.25*s;
    }
    const mag=Math.hypot(x,y,z,w)||1;
    return [x/mag,y/mag,z/mag,w/mag];
  }
  function matFromQuat(q) {
    const [x,y,z,w]=q;
    return [
      1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w),
      2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),
      2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)
    ];
  }
  function slerp(a,b,t){
    let dot=a.reduce((n,v,i)=>n+v*b[i],0);
    if(dot<0){b=b.map(v=>-v);dot=-dot;}
    if(dot>.9995){
      const n=a.map((v,i)=>v+(b[i]-v)*t),mag=Math.hypot(...n)||1;
      return n.map(v=>v/mag);
    }
    const theta=Math.acos(clamp(dot,-1,1)),sin=Math.sin(theta);
    const p=Math.sin((1-t)*theta)/sin,q=Math.sin(t*theta)/sin;
    return a.map((v,i)=>p*v+q*b[i]);
  }
  function mixTransform(a,b,t){
    const qa=quatFromMat(a),qb=quatFromMat(b);
    return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t,...matFromQuat(slerp(qa,qb,t))];
  }
  function keyframeMatrix(f,bone){
    const p=f.poses.find(p=>p.name===bone && p.weight>0);
    return p?p.matrix:IDENTITY;
  }
  function sampleFrame(c,time) {
    const frames=c.frames;
    if(frames.length===1 || time<=frames[0].time) return Object.fromEntries(bones.map(n=>[n,keyframeMatrix(frames[0],n)]));
    if(time>=frames[frames.length-1].time)return Object.fromEntries(bones.map(n=>[n,keyframeMatrix(frames[frames.length-1],n)]));
    let lo=0,hi=frames.length-1;
    while(hi-lo>1) {const mid=(hi+lo)>>1;if(frames[mid].time<=time)lo=mid;else hi=mid;}
    const left=frames[lo],right=frames[hi],t=clamp((time-left.time)/Math.max(.000001,right.time-left.time),0,1);
    return Object.fromEntries(bones.map(n=>[n,mixTransform(keyframeMatrix(left,n),keyframeMatrix(right,n),t)]));
  }

  function makeDemo(name,kind){
    const transforms=(time)=>{
      const wave=kind==='Wave', body={};
      const progress=kind==='Wave'?time/1.5:time/1.6, step=Math.sin(progress*Math.PI*2);
      body['Torso']=matrixFromControls([0,Math.sin(progress*Math.PI*2)*.055,0,0,0,step*2]);
      body.Head=matrixFromControls([0,0,0,0,step*5,step*5]);
      body['Left Arm']=matrixFromControls([0,0,0,wave?-6:step*19,0,wave?-8:step*3]);
      body['Right Arm']=matrixFromControls([0,0,0,wave?(-130+Math.sin(progress*Math.PI*4)*18):-step*19,0,wave?-13:-step*3]);
      body['Left Leg']=matrixFromControls([0,0,0,wave?0:-step*21,0,0]);
      body['Right Leg']=matrixFromControls([0,0,0,wave?0:step*21,0,0]);
      return bones.map(n=>blankPose(n,body[n]));
    };
    const times=kind==='Wave'?[0,.25,.5,.75,1,1.25,1.5]:[0,.2,.4,.6,.8,1,1.2,1.4,1.6];
    return {id:newId(),filename:cleanFilename(name),name,frames:times.map(time=>({time,poses:transforms(time)})),unsaved:false,isDemo:true};
  }
  function blankClip(){
    return {
      id:newId(),filename:'Untitled.anim',name:'Untitled Animation',
      frames:[{time:0,poses:bones.map(n=>blankPose(n))},{time:1,poses:bones.map(n=>blankPose(n))}],
      unsaved:true,isDemo:false
    };
  }
  async function openDatabase(){
    if(!('indexedDB' in window)) return null;
    return new Promise(resolve=>{
      let req;
      try{req=indexedDB.open(DB_NAME,1);}catch(e){resolve(null);return;}
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('clips'))req.result.createObjectStore('clips',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>resolve(null);
      req.onblocked=()=>resolve(null);
    });
  }
  function txStore(mode) {
    if(!state.db)return null;
    try{return state.db.transaction('clips',mode).objectStore('clips');}catch(e){return null;}
  }
  async function saveToBrowser(c,silent) {
    const store=txStore('readwrite');
    if(!store){if(!silent)toast('Browser storage is unavailable; use Export .anim instead.',true);return;}
    let data;
    try{data=exportAnim(c);}catch(e){toast(e.message,true);return;}
    await new Promise(resolve=>{
      const req=store.put({id:c.id,filename:c.filename,data,edited:Date.now()});
      req.onsuccess=resolve;req.onerror=resolve;
    });
    c.unsaved=false;
    if(!silent){toast('Saved to this browser. Your file stays on this device.');status('Saved ' + c.filename + ' to browser storage.');}
    renderLibrary();
  }
  async function removeFromBrowser(id){
    const store=txStore('readwrite');if(!store)return;
    await new Promise(resolve=>{const req=store.delete(id);req.onsuccess=resolve;req.onerror=resolve;});
  }
  async function restoreLibrary() {
    state.db=await openDatabase();
    const store=txStore('readonly');if(!store)return;
    const items=await new Promise(resolve=>{
      const req=store.getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>resolve([]);
    });
    let first=null;
    for(const item of items.slice(0,100)){
      try{
        const doc=parseAnim(item.data);
        const c={id:item.id,filename:item.filename,name:doc.name,frames:doc.frames,unsaved:false,isDemo:false};
        const already=state.clips.some(existing=>existing.id===c.id);
        if(!already){state.clips.push(c);if(!first)first=c;}
      }catch(e){/* Ignore damaged local clips. */}
    }
    if(first && state.clips.length)activate(first.id,false);
    renderLibrary();
  }
  function activate(id,showMessage) {
    const selected=state.clips.find(c=>c.id===id);
    if(!selected)return;
    state.activeId=id;state.frameIndex=0;state.time=0;state.playing=false;
    $('clip-name').value=selected.name;
    $('workspace-filename').textContent=selected.filename;
    $('viewport-mode').textContent=selected.isDemo?'SAMPLE / R6':'R6 PREVIEW';
    renderLibrary();renderTimeline();renderInspector();updatePlaybackUI();
    if(showMessage)status('Opened ' + selected.filename + ' · ' + selected.frames.length + ' keyframes');
  }
  function markChanged(){
    const c=clip();if(!c)return;
    c.unsaved=true;c.isDemo=false;
    $('workspace-filename').textContent=c.filename + ' *';
    renderLibrary();renderTimeline();updatePlaybackUI();
    status('Unsaved changes · Export .anim or Save locally');
  }
  async function importFiles(files){
    let ok=0,errors=[];
    for(const f of Array.from(files).slice(0,35)){
      if(!/\.anim$/i.test(f.name)){errors.push(f.name + ': expected .anim');continue;}
      try{
        const buffer=await f.arrayBuffer(),parsed=parseAnim(buffer);
        if(state.clips.length>=100)throw new Error('Library limit reached (100 files).');
        const c={id:newId(),filename:cleanFilename(f.name),name:parsed.name,frames:parsed.frames,unsaved:false,isDemo:false};
        state.clips.push(c);activate(c.id,true);ok++;
        await saveToBrowser(c,true);
      }catch(e){errors.push(f.name + ': ' + (e.message||'Invalid file'));}
    }
    $('file-input').value='';
    if(ok)toast(ok + ' animation' + (ok!==1?'s':'') + ' imported successfully.');
    if(errors.length){toast(errors[0] + (errors.length>1?' (+'+(errors.length-1)+' more)':''),true);status(errors[0]);}
    renderLibrary();
    if(ok)document.getElementById('studio').scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderLibrary(){
    const host=$('library-items');host.replaceChildren();
    const term=$('library-search').value.trim().toLowerCase();
    const matching=state.clips.filter(c=>(c.filename+' '+c.name).toLowerCase().includes(term));
    $('library-count').textContent=state.clips.length+' FILES';
    if(!matching.length){
      const empty=document.createElement('div');empty.className='library-empty';
      empty.textContent=state.clips.length?'No matching animations.':'No files yet. Import an .anim file or load a sample.';
      host.appendChild(empty);return;
    }
    for(const c of matching) {
      const b=document.createElement('button');b.type='button';b.className='library-item'+(c.id===state.activeId?' selected':'');
      const ico=document.createElement('span');ico.className='file-icon';ico.textContent='ANIM';
      const info=document.createElement('span');info.className='file-info';
      const strong=document.createElement('strong');strong.textContent=c.filename+(c.unsaved?' *':'');
      const small=document.createElement('small');small.textContent=c.frames.length+' frames · '+c.frames[c.frames.length-1].time.toFixed(2)+'s'+(c.isDemo?' · demo':'');
      info.append(strong,small);b.append(ico,info);
      if(c.id===state.activeId){const dot=document.createElement('span');dot.className='file-selected-dot';b.appendChild(dot);}
      b.addEventListener('click',()=>activate(c.id,true));host.appendChild(b);
    }
  }
  function renderTimeline(){
    const c=clip();const host=$('timeline-track');host.replaceChildren();if(!c)return;
    c.frames.forEach((f,i)=>{
      const b=document.createElement('button');
      b.type='button';b.className='frame-chip'+(i===state.frameIndex?' selected':'');
      b.textContent=f.time.toFixed(2)+'s';
      b.title='Keyframe '+(i+1)+' / '+c.frames.length;
      b.addEventListener('click',()=>{state.playing=false;state.frameIndex=i;state.time=f.time;renderTimeline();renderInspector();updatePlaybackUI();});
      host.appendChild(b);
    });
  }
  function chosenPose() {
    const c=clip();if(!c)return null;
    const f=c.frames[state.frameIndex];if(!f)return null;
    let p=f.poses.find(p=>p.name===state.bone);
    if(!p){p=blankPose(state.bone);f.poses.push(p);}
    return p;
  }
  const sliders={};
  function setupTransformControls() {
    const definitions=[
      ['position-controls',-2,2,.01],
      ['rotation-controls',-180,180,1]
    ];
    definitions.forEach(([container,min,max,step],group)=>{
      const host=$(container);
      ['X','Y','Z'].forEach((axis,i)=>{
        const row=document.createElement('div');row.className='axis-control '+axis.toLowerCase();
        const label=document.createElement('span');label.textContent=axis;
        const range=document.createElement('input');range.type='range';range.min=min;range.max=max;range.step=step;
        const num=document.createElement('input');num.type='number';num.min=min;num.max=max;num.step=step;
        range.setAttribute('aria-label',(group?'Rotation ':'Position ')+axis);
        num.setAttribute('aria-label',(group?'Rotation ':'Position ')+axis+' value');
        const idx=group*3+i;sliders[idx]={range,num,min,max};
        range.addEventListener('input',()=>{
          num.value=range.value;updateTransformFromSliders();
        });
        num.addEventListener('change',()=>{
          const v=clamp(Number(num.value)||0,min,max);range.value=v;num.value=v;updateTransformFromSliders();
        });
        row.append(label,range,num);host.appendChild(row);
      });
    });
  }
  function loadSliderValues() {
    const c=clip();if(!c)return;
    const f=c.frames[state.frameIndex], matrix=keyframeMatrix(f,state.bone);
    const values=controlsFromMatrix(matrix);
    for(let i=0;i<6;i++) {
      const item=sliders[i],val=clamp(values[i],item.min,item.max);
      item.range.value=val.toFixed(i<3?2:0);
      item.num.value=val.toFixed(i<3?2:0);
    }
  }
  function updateTransformFromSliders() {
    if(!clip())return;
    const values=Array.from({length:6},(_,i)=>Number(sliders[i].range.value)||0);
    const p=chosenPose();p.matrix=matrixFromControls(values);
    state.playing=false;
    state.time=clip().frames[state.frameIndex].time;
    markChanged();
  }
  function renderInspector(){
    const c=clip();if(!c)return;
    $('stat-frames').textContent=c.frames.length;
    $('stat-duration').textContent=c.frames[c.frames.length-1].time.toFixed(2)+'s';
    $('frame-time').value=c.frames[state.frameIndex].time.toFixed(2);
    $('joint-select').value=state.bone;
    loadSliderValues();
  }
  function updatePlaybackUI(){
    const c=clip();if(!c)return;
    const max=Math.max(c.frames[c.frames.length-1].time,.001);
    $('time-current').textContent=fmt(state.time);
    $('time-end').textContent=fmt(max);
    $('time-scrub').max=max;
    $('time-scrub').value=clamp(state.time,0,max);
    $('play-button').textContent=state.playing?'Ⅱ':'▶';
    $('play-button').setAttribute('aria-label',state.playing?'Pause animation':'Play animation');
    $('stat-duration').textContent=c.frames[c.frames.length-1].time.toFixed(2)+'s';
  }
  function download(data,filename,mime){
    const blob = data instanceof Blob ? data : new Blob([data],{type:mime||'application/octet-stream'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  }

  // ---------- R6 orbiting software 3D viewport ----------
  const canvas=$('rig-canvas'),ctx=canvas.getContext('2d',{alpha:false});
  let width=640,height=360,dpr=1;
  const identityTransform=()=>({p:[0,0,0],r:[1,0,0,0,1,0,0,0,1]});
  function translate(x,y,z){return {p:[x,y,z],r:[1,0,0,0,1,0,0,0,1]};}
  function fromCFrame(m){return {p:[m[0],m[1],m[2]],r:m.slice(3)};}
  function transformPoint(t,v){
    const r=t.r,p=t.p;
    return [p[0]+r[0]*v[0]+r[1]*v[1]+r[2]*v[2],
            p[1]+r[3]*v[0]+r[4]*v[1]+r[5]*v[2],
            p[2]+r[6]*v[0]+r[7]*v[1]+r[8]*v[2]];
  }
  function multiply(a,b){
    const R=[],ar=a.r,br=b.r;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      R[row*3+col]=ar[row*3]*br[col]+ar[row*3+1]*br[3+col]+ar[row*3+2]*br[6+col];
    }
    return {p:transformPoint(a,b.p),r:R};
  }
  function project(v){
    const yaw=state.yaw,pitch=state.pitch;
    const xx=v[0]*Math.cos(yaw)+v[2]*Math.sin(yaw);
    const depth=-v[0]*Math.sin(yaw)+v[2]*Math.cos(yaw);
    const yy=(v[1]-2.35)*Math.cos(pitch)-depth*Math.sin(pitch);
    const zz=(v[1]-2.35)*Math.sin(pitch)+depth*Math.cos(pitch);
    const scale=Math.min(width/8.1,height/6.9)*state.zoom;
    return {x:width*.5+xx*scale,y:height*.50-yy*scale,depth:zz};
  }
  function gridLine(a,b){
    const p=project(a),q=project(b);
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
  }
  function drawGrid(){
    if(!state.grid)return;
    ctx.save();ctx.lineWidth=1;
    for(let i=-5;i<=5;i++) {
      ctx.strokeStyle=i===0?'rgba(170,136,255,.23)':'rgba(124,130,189,.12)';
      gridLine([i,0,-5],[i,0,5]);
      gridLine([-5,0,i],[5,0,i]);
    }
    ctx.restore();
  }
  function facesForBox(box,selected){
    const s=box.size,t=box.t;
    const vertices=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])
      vertices.push(project(transformPoint(t,[s[0]*x/2,s[1]*y/2,s[2]*z/2])));
    const faceIndices=[
      {i:[0,1,3,2],shade:-18},
      {i:[4,6,7,5],shade:8},
      {i:[0,4,5,1],shade:-10},
      {i:[2,3,7,6],shade:16},
      {i:[0,2,6,4],shade:-21},
      {i:[1,5,7,3],shade:8}
    ];
    return faceIndices.map(f=>({
      v:f.i.map(i=>vertices[i]),z:f.i.reduce((sum,i)=>sum+vertices[i].depth,0)/4,
      color:box.color,shade:f.shade,name:box.name,selected
    }));
  }
  function shadeColor(hex,amount){
    const rgb=parseInt(hex.slice(1),16);
    const x=(rgb>>16)&255,y=(rgb>>8)&255,z=rgb&255;
    return 'rgb('+clamp(x+amount,0,255)+','+clamp(y+amount,0,255)+','+clamp(z+amount,0,255)+')';
  }
  function drawFace(face){
    const v=face.v;ctx.beginPath();ctx.moveTo(v[0].x,v[0].y);
    for(let i=1;i<v.length;i++)ctx.lineTo(v[i].x,v[i].y);
    ctx.closePath();ctx.fillStyle=shadeColor(face.color,face.shade);ctx.fill();
    ctx.strokeStyle=face.selected?'rgba(237,205,255,.85)':'rgba(20,12,38,.55)';
    ctx.lineWidth=face.selected?1.7:1.1;ctx.stroke();
  }
  function drawRig(){
    const c=clip();if(!c)return;
    const pose=sampleFrame(c,state.time);
    const torso=multiply(translate(0,2.64,0),fromCFrame(pose.Torso));
    const head=multiply(multiply(torso,translate(0,1.02,0)),fromCFrame(pose.Head));
    const leftArm=multiply(multiply(multiply(torso,translate(-1.39,.62,0)),fromCFrame(pose['Left Arm'])),translate(0,-.89,0));
    const rightArm=multiply(multiply(multiply(torso,translate(1.39,.62,0)),fromCFrame(pose['Right Arm'])),translate(0,-.89,0));
    const leftLeg=multiply(multiply(multiply(torso,translate(-.52,-1.03,0)),fromCFrame(pose['Left Leg'])),translate(0,-.91,0));
    const rightLeg=multiply(multiply(multiply(torso,translate(.52,-1.03,0)),fromCFrame(pose['Right Leg'])),translate(0,-.91,0));
    const boxes=[
      {name:'Torso',t:torso,size:[2,2,1.05],color:'#9974e4'},
      {name:'Head',t:multiply(head,translate(0,.35,0)),size:[1.62,1.53,1.42],color:'#dabafb'},
      {name:'Left Arm',t:leftArm,size:[.79,1.83,.85],color:'#b49bf4'},
      {name:'Right Arm',t:rightArm,size:[.79,1.83,.85],color:'#b49bf4'},
      {name:'Left Leg',t:leftLeg,size:[.85,1.84,.88],color:'#8066c5'},
      {name:'Right Leg',t:rightLeg,size:[.85,1.84,.88],color:'#8066c5'}
    ];
    const faces=[],hitboxes=[];
    for(const box of boxes){
      const ownFaces=facesForBox(box,box.name===state.bone);
      faces.push(...ownFaces);
      const all=ownFaces.flatMap(f=>f.v);
      hitboxes.push({
        name:box.name,minX:Math.min(...all.map(v=>v.x)),maxX:Math.max(...all.map(v=>v.x)),
        minY:Math.min(...all.map(v=>v.y)),maxY:Math.max(...all.map(v=>v.y)),
        depth:all.reduce((sum,v)=>sum+v.depth,0)/all.length
      });
    }
    faces.sort((a,b)=>a.z-b.z);
    for(const face of faces)drawFace(face);
    state.hitboxes=hitboxes.sort((a,b)=>b.depth-a.depth);
    // Simple classic R6 face.
    const faceTransform=multiply(head,translate(0,.35,0));
    const eyePoints=[[-.24,.1,.735],[.24,.1,.735]];
    ctx.fillStyle='#34234e';
    for(const p of eyePoints){
      const c=project(transformPoint(faceTransform,p));
      ctx.beginPath();ctx.arc(c.x,c.y,Math.max(1.7,state.zoom*2.7),0,Math.PI*2);ctx.fill();
    }
    const a=project(transformPoint(faceTransform,[-.19,-.18,.741])),
          b=project(transformPoint(faceTransform,[0,-.24,.744])),
          cc=project(transformPoint(faceTransform,[.19,-.18,.741]));
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(b.x,b.y+6,cc.x,cc.y);
    ctx.strokeStyle='#34234e';ctx.lineWidth=1.6;ctx.stroke();
  }
  function redraw(){
    if(!ctx)return;
    ctx.clearRect(0,0,width,height);
    const bg=ctx.createRadialGradient(width*.48,height*.4,10,width*.48,height*.45,Math.max(width,height)*.7);
    bg.addColorStop(0,'#27223e');bg.addColorStop(.55,'#151729');bg.addColorStop(1,'#10141f');
    ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    drawGrid();
    ctx.save();ctx.globalAlpha=.3;
    const center=project([0,.06,0]);
    ctx.beginPath();ctx.ellipse(center.x,center.y,65*state.zoom,15*state.zoom,0,0,Math.PI*2);
    ctx.fillStyle='#050413';ctx.fill();ctx.restore();
    drawRig();
  }
  function resizeCanvas(){
    const rect=canvas.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    dpr=Math.min(window.devicePixelRatio||1,2);
    width=rect.width;height=rect.height;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    redraw();
  }

  // ---------- Interaction and timeline ----------
  function addFrame(){
    const c=clip();if(!c)return;
    if(c.frames.length>=MAX_FRAMES){toast('Maximum 1500 keyframes.',true);return;}
    const time=clamp(state.time,0,300);
    if(c.frames.some(f=>Math.abs(f.time-time)<.0005)){toast('A keyframe already exists at this time.');return;}
    const poseAtTime=sampleFrame(c,time),nearest=c.frames.reduce((best,f)=>Math.abs(f.time-time)<Math.abs(best.time-time)?f:best,c.frames[0]);
    const poses=nearest.poses.filter(p=>!bones.includes(p.name)).map(p=>({...p,matrix:copyMatrix(p.matrix)}));
    bones.forEach(n=>poses.push(blankPose(n,poseAtTime[n])));
    const frame={time,poses};c.frames.push(frame);c.frames.sort((a,b)=>a.time-b.time);
    state.frameIndex=c.frames.indexOf(frame);state.playing=false;
    markChanged();renderInspector();status('Added keyframe at '+time.toFixed(2)+'s');
  }
  function deleteFrame(){
    const c=clip();if(!c)return;
    if(c.frames.length<=1){toast('Keep at least one keyframe.',true);return;}
    c.frames.splice(state.frameIndex,1);
    state.frameIndex=clamp(state.frameIndex,0,c.frames.length-1);
    state.time=c.frames[state.frameIndex].time;state.playing=false;
    markChanged();renderInspector();
  }
  function wire(){
    const input=$('file-input');
    [ 'hero-upload','main-upload'].forEach(id=>$(id).addEventListener('click',()=>input.click()));
    input.addEventListener('change',e=>importFiles(e.target.files));
    $('library-search').addEventListener('input',renderLibrary);
    const drop=$('drop-zone');
    const dragSet=['dragenter','dragover'];
    dragSet.forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.add('drag-over');}));
    ['dragleave','drop'].forEach(name=>drop.addEventListener(name,e=>{e.preventDefault();drop.classList.remove('drag-over');}));
    drop.addEventListener('drop',e=>importFiles(e.dataTransfer.files));
    window.addEventListener('dragover',e=>e.preventDefault());
    window.addEventListener('drop',e=>{
      if(e.target.closest && e.target.closest('#drop-zone'))return;
      e.preventDefault();if(e.dataTransfer&&e.dataTransfer.files.length)importFiles(e.dataTransfer.files);
    });

    $('demo-button').addEventListener('click',()=>{
      const c=makeDemo('Wave Sample','Wave');state.clips.push(c);activate(c.id,true);
      toast('Loaded Wave Sample. Edit it or export it as .anim.');
    });
    $('new-project').addEventListener('click',()=>{
      if(state.clips.length>=100){toast('Library limit reached (100 files).',true);return;}
      const c=blankClip();state.clips.push(c);activate(c.id,true);
    });
    $('save-browser').addEventListener('click',async()=>{if(clip())await saveToBrowser(clip(),false);});
    $('export-file').addEventListener('click',()=>{
      const c=clip();if(!c)return;
      try{
        download(exportAnim(c),cleanFilename(c.name),'application/octet-stream');
        status('Downloaded '+cleanFilename(c.name));
        toast('Export complete. Place this file in Mr H’s Anims folder.');
      }catch(e){toast(e.message,true);}
    });
    $('png-export').addEventListener('click',()=>{
      canvas.toBlob(blob=>{if(blob)download(blob,cleanFilename(clip().name).replace(/\.anim$/i,'.png'),'image/png');},'image/png');
    });
    $('reset-camera').addEventListener('click',()=>{state.yaw=.59;state.pitch=.23;state.zoom=1;redraw();});
    $('toggle-grid').addEventListener('click',e=>{
      state.grid=!state.grid;e.currentTarget.classList.toggle('tool-active',state.grid);redraw();
    });
    $('play-button').addEventListener('click',()=>{
      const c=clip();if(!c)return;
      const dur=c.frames[c.frames.length-1].time;
      if(!state.playing && state.time>=dur-.0001)state.time=0;
      state.playing=!state.playing;
      state.lastTick=performance.now();updatePlaybackUI();
    });
    $('stop-button').addEventListener('click',()=>{state.playing=false;state.time=0;updatePlaybackUI();});
    $('loop-toggle').addEventListener('change',e=>{state.loop=e.target.checked;});
    $('speed-select').addEventListener('change',e=>{state.speed=clamp(Number(e.target.value)||1,.25,3);});
    $('time-scrub').addEventListener('input',e=>{
      const c=clip();if(!c)return;state.time=clamp(Number(e.target.value)||0,0,c.frames[c.frames.length-1].time);
      state.playing=false;updatePlaybackUI();redraw();
    });
    $('add-frame').addEventListener('click',addFrame);
    $('delete-frame').addEventListener('click',deleteFrame);
    $('joint-select').addEventListener('change',e=>{state.bone=e.target.value;loadSliderValues();redraw();});
    $('clip-name').addEventListener('input',e=>{
      const c=clip();if(!c)return;
      c.name=e.target.value.slice(0,80);markChanged();
    });
    $('frame-time').addEventListener('change',e=>{
      const c=clip();if(!c)return;
      const time=clamp(Number(e.target.value)||0,0,300);
      c.frames[state.frameIndex].time=time;
      const selected=c.frames[state.frameIndex];
      c.frames.sort((a,b)=>a.time-b.time);
      state.frameIndex=c.frames.indexOf(selected);state.time=time;state.playing=false;
      markChanged();renderInspector();
    });
    $('reset-pose').addEventListener('click',()=>{
      const p=chosenPose();if(!p)return;
      p.matrix=copyMatrix(IDENTITY);loadSliderValues();state.playing=false;
      state.time=clip().frames[state.frameIndex].time;markChanged();redraw();
    });
    let start=null;
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0 && e.pointerType==='mouse')return;
      start={x:e.clientX,y:e.clientY,yaw:state.yaw,pitch:state.pitch,dragged:false};
      try{canvas.setPointerCapture(e.pointerId);}catch(err){}
    });
    canvas.addEventListener('pointermove',e=>{
      if(!start)return;
      const dx=e.clientX-start.x,dy=e.clientY-start.y;
      if(Math.hypot(dx,dy)>4)start.dragged=true;
      if(start.dragged){
        state.yaw=start.yaw+dx*.009;state.pitch=clamp(start.pitch-dy*.007,-.4,1.05);
        redraw();
      }
    });
    canvas.addEventListener('pointerup',e=>{
      if(!start)return;
      if(!start.dragged){
        const bounds=canvas.getBoundingClientRect();
        const x=e.clientX-bounds.left,y=e.clientY-bounds.top;
        const hit=state.hitboxes.find(box=>x>=box.minX&&x<=box.maxX&&y>=box.minY&&y<=box.maxY);
        if(hit){state.bone=hit.name;$('joint-select').value=hit.name;loadSliderValues();redraw();}
      }
      start=null;
    });
    canvas.addEventListener('pointercancel',()=>{start=null;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=clamp(state.zoom*(e.deltaY<0?1.08:.92),.55,2.15);redraw();},{passive:false});
    window.addEventListener('keydown',e=>{
      if(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
      if(e.code==='Space'){e.preventDefault();$('play-button').click();}
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
        e.preventDefault();const c=clip();if(!c)return;
        state.frameIndex=clamp(state.frameIndex+(e.key==='ArrowRight'?1:-1),0,c.frames.length-1);
        state.time=c.frames[state.frameIndex].time;state.playing=false;
        renderTimeline();renderInspector();updatePlaybackUI();
      }
    });
    if('ResizeObserver' in window){
      resizeObserver=new ResizeObserver(resizeCanvas);
      resizeObserver.observe(canvas);
    }else window.addEventListener('resize',resizeCanvas);
  }
  function tick(ts){
    const c=clip();
    if(c && state.playing){
      const dt=Math.min((ts-(state.lastTick||ts))/1000,.09),end=c.frames[c.frames.length-1].time;
      state.time+=dt*state.speed;
      if(end<=.001){state.time=0;state.playing=false;}
      else if(state.time>=end){
        if(state.loop)state.time=state.time%end;
        else{state.time=end;state.playing=false;}
      }
      updatePlaybackUI();
    }
    state.lastTick=ts;
    redraw();
    requestAnimationFrame(tick);
  }
  setupTransformControls();
  wire();
  const demo=makeDemo('Walk Cycle','Walk');
  state.clips.push(demo);activate(demo.id,false);status('Ready · Walk Cycle demo loaded');
  resizeCanvas();
  requestAnimationFrame(tick);
  restoreLibrary().catch(()=>{});
})();
