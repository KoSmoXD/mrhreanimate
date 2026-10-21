/* Shared, bounded animation document and cubic Bezier timing. Angles: XYZ degrees, local Motor6D space. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.MrhMotion=api;})(globalThis,()=>{
'use strict';
const PARTS=['Torso','Head','Left Arm','Right Arm','Left Leg','Right Leg'];
const clone=v=>JSON.parse(JSON.stringify(v));
const neutral=part=>({part,position:[0,0,0],rotation:[0,0,0],curve:[.25,.1,.25,1]});
function validate(value){
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>80)throw Error('Animation needs a title of 1–80 characters.');
 if(!Number.isFinite(value.duration)||value.duration<.1||value.duration>30)throw Error('Duration must be 0.1–30 seconds.');
 if(!Array.isArray(value.frames)||value.frames.length<2||value.frames.length>1500)throw Error('Use 2–1500 keyframes.');
 let last=-1;
 for(const f of value.frames){
  if(!Number.isFinite(f.time)||f.time<0||f.time>value.duration||f.time<=last)throw Error('Keyframes must have unique, increasing times within the duration.');last=f.time;
  if(!Array.isArray(f.poses)||f.poses.length!==6||new Set(f.poses.map(p=>p.part)).size!==6)throw Error('Every frame must contain all six R6 parts.');
  for(const p of f.poses){if(!PARTS.includes(p.part))throw Error('Unknown R6 part.');
   for(const [field,n,limit]of [['position',3,100],['rotation',3,3600],['curve',4,3]])if(!Array.isArray(p[field])||p[field].length!==n||!p[field].every(x=>Number.isFinite(x)&&Math.abs(x)<=limit))throw Error('Invalid '+field+' values.');
   if(p.curve[0]<0||p.curve[0]>1||p.curve[2]<0||p.curve[2]>1)throw Error('Curve handle X must be between 0 and 1.');
  }
 }
 if(Math.abs(value.frames[0].time)>1e-5||Math.abs(last-value.duration)>1e-5)throw Error('Include a keyframe at time 0 and at the animation end.');
 return clone(value);
}
function bezier(c,t){const b=(a,z,u)=>3*(1-u)**2*u*a+3*(1-u)*u*u*z+u**3;let lo=0,hi=1;for(let i=0;i<24;i++){const m=(lo+hi)/2;if(b(c[0],c[2],m)<t)lo=m;else hi=m;}return t<=0?0:t>=1?1:b(c[1],c[3],(lo+hi)/2);}
function blank(){return{title:'Untitled motion',duration:2,frames:[0,2].map(time=>({time,poses:PARTS.map(neutral)}))};}
function matrix(r){const [x,y,z]=r.map(v=>v*Math.PI/180),a=Math.cos(x),b=Math.sin(x),c=Math.cos(y),d=Math.sin(y),e=Math.cos(z),f=Math.sin(z);return[c*e,-c*f,d,a*f+b*e*d,a*e-b*f*d,-b*c,b*f-a*e*d,b*e+a*f*d,a*c];}
function euler(m){const y=Math.asin(Math.max(-1,Math.min(1,m[2])));return(Math.abs(m[2])<.9999999?[Math.atan2(-m[5],m[8]),y,Math.atan2(-m[1],m[0])]:[Math.atan2(m[7],m[4]),y,0]).map(v=>v*180/Math.PI);}
function parse(buffer){
 if(buffer.byteLength>8000000)throw Error('Animation exceeds 8 MB.');const v=new DataView(buffer);let at=0;
 const need=n=>{if(at+n>v.byteLength)throw Error('Truncated .anim file.');const p=at;at+=n;return p;},u16=()=>v.getUint16(need(2),true),u32=()=>v.getUint32(need(4),true),num=()=>{const n=v.getFloat32(need(4),true);if(!Number.isFinite(n))throw Error('Invalid animation number.');return n;},word=()=>{const n=u16();if(n>512)throw Error('Invalid string.');return new TextDecoder().decode(new Uint8Array(buffer,need(n),n));};
 const title=word(),count=u32();if(count<2||count>1500)throw Error('Unsupported frame count.');const frames=[];const previous=PARTS.map(neutral);
 for(let i=0;i<count;i++){const time=num(),n=u32();if(n>100)throw Error('Too many poses.');const poses=[];for(let j=0;j<n;j++){const part=word(),weight=num(),style=word(),dir=word(),m=Array.from({length:12},num);if(PARTS.includes(part)&&weight>0){const p={part,position:m.slice(0,3),rotation:euler(m.slice(3)),curve:[0,0,1,1],style,dir};previous[PARTS.indexOf(part)]=p;}}poses.push(...clone(previous));frames.push({time,poses});}
 if(at!==v.byteLength)throw Error('Unexpected trailing data.');frames.sort((a,b)=>a.time-b.time);
 return validate({title:(title||'Imported animation').slice(0,80),duration:frames.at(-1).time,frames});
}
function bakeTimes(clip,fps=30){const times=new Set(clip.frames.map(f=>Math.fround(f.time)));for(let i=0;i<Math.ceil(clip.duration*fps);i++)times.add(Math.fround(i/fps));times.add(Math.fround(clip.duration));return [...times].sort((a,b)=>a-b);}
function encode(frames,title){const chunks=[],enc=new TextEncoder;const push=(n,size,method)=>{const a=new ArrayBuffer(size);new DataView(a)[method](0,n,true);chunks.push(new Uint8Array(a));};const word=s=>{const a=enc.encode(s);push(a.length,2,'setUint16');chunks.push(a);};word(title);push(frames.length,4,'setUint32');for(const f of frames){push(f.time,4,'setFloat32');push(f.poses.length,4,'setUint32');for(const p of f.poses){word(p.part);push(1,4,'setFloat32');word('Linear');word('InOut');for(const n of [...p.position,...(p.matrix||matrix(p.rotation))])push(n,4,'setFloat32');}}const out=new Uint8Array(chunks.reduce((s,a)=>s+a.length,0));let offset=0;for(const a of chunks){out.set(a,offset);offset+=a.length;}return out;}
return{PARTS,clone,neutral,validate,bezier,blank,matrix,euler,parse,encode,bakeTimes};
});
