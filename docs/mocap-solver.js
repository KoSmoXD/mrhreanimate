/* Camera Motion v2 — R6 joint rotations from MediaPipe world landmarks.
   Inspired by the supplied r6_tracker.py: 3x3 matrices, torso-local limb aim,
   180-degree-safe rotations, visibility hysteresis and upright calibration.
   No camera frames leave this browser. */
(function(global){
'use strict';
const IDX={nose:0,le:7,re:8,ls:11,rs:12,lw:15,rw:16,lh:23,rh:24,la:27,ra:28};
const PARTS=['neck','sh_l','sh_r','hip_l','hip_r','root'];
const I=[1,0,0,0,1,0,0,0,1];
const vec=p=>[Number(p.x),Number(p.y),Number(p.z)];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul=(a,s)=>a.map(v=>v*s);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>{const d=Math.hypot(...a);return d>1e-7&&Number.isFinite(d)?mul(a,1/d):null;};
const avg=(a,b)=>mul(add(a,b),.5);
const col=(x,y,z)=>[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]];
const trans=m=>[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
const times=(a,b)=>{const c=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)c[i*3+j]=a[i*3]*b[j]+a[i*3+1]*b[3+j]+a[i*3+2]*b[6+j];return c;};
function fromTo(a,b){
 const v=cross(a,b),c=Math.max(-1,Math.min(1,dot(a,b)));
 if(c>1-1e-6)return I.slice();
 if(c<-(1-1e-6)){
  let axis=norm(cross(a,[1,0,0]))||norm(cross(a,[0,1,0]));
  if(!axis)return I.slice();
  return axis.flatMap((x,i)=>axis.map((y,j)=>2*x*y-(i===j?1:0)));
 }
 const k=1/(1+c),[x,y,z]=v;
 return [1-(y*y+z*z)*k,x*y*k-z,x*z*k+y,
         y*x*k+z,1-(x*x+z*z)*k,y*z*k-x,
         z*x*k-y,z*y*k+x,1-(x*x+y*y)*k];
}
function basis(xRaw,upRaw){
 const x=norm(xRaw),u=norm(upRaw);
 if(!x||!u)return null;
 const z=norm(cross(x,u));if(!z)return null;
 const x2=norm(cross(u,z));if(!x2)return null;
 const y=norm(cross(z,x2));return y?{x:x2,y,z,m:col(x2,y,z)}:null;
}
function createSolver(){
 let previous={},visible={},calibration=null,origin=null,lastOutput=null;
 function valid(normalized,i){
  const v=normalized?.[i]?.visibility??1;
  const p=visible[i]??(v>.30);
  visible[i]=p?v>.30:v>=.45;
  return visible[i];
 }
 function keep(key,mt,now){
  if(mt){previous[key]={mt,time:now};return mt;}
  const old=previous[key];
  return old&&now-old.time<600?old.mt:I.slice();
 }
 function reset(){previous={};visible={};calibration=null;origin=null;lastOutput=null;}
 function solve(world,normalized,now=Date.now()){
  if(!Array.isArray(world)||world.length<29||!Array.isArray(normalized))return null;
  if(!world.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z)))return null;
  if(![11,12,23,24].every(i=>valid(normalized,i)))return null;
  const p=i=>vec(world[i]);
  const leftShoulder=p(IDX.ls),rightShoulder=p(IDX.rs);
  const leftHip=p(IDX.lh),rightHip=p(IDX.rh);
  const shoulder=avg(leftShoulder,rightShoulder),hip=avg(leftHip,rightHip);
  const tor=basis(sub(rightShoulder,leftShoulder),sub(shoulder,hip));
  if(!tor)return null;
  const worldToTorso=trans(tor.m),limb=(start,end)=>fromTo([0,-1,0],norm([
   dot(sub(end,start),tor.x),dot(sub(end,start),tor.y),dot(sub(end,start),tor.z)
  ])||[0,-1,0]);
  const raw={};
  raw.sh_l=keep('sh_l',valid(normalized,IDX.lw)?limb(leftShoulder,p(IDX.lw)):null,now);
  raw.sh_r=keep('sh_r',valid(normalized,IDX.rw)?limb(rightShoulder,p(IDX.rw)):null,now);
  raw.hip_l=keep('hip_l',valid(normalized,IDX.la)?limb(leftHip,p(IDX.la)):null,now);
  raw.hip_r=keep('hip_r',valid(normalized,IDX.ra)?limb(rightHip,p(IDX.ra)):null,now);
  let head=null;
  if(valid(normalized,IDX.nose)&&valid(normalized,IDX.le)&&valid(normalized,IDX.re)){
   const x=norm(sub(p(IDX.re),p(IDX.le)));
   const face=sub(p(IDX.nose),avg(p(IDX.le),p(IDX.re)));
   const front=x&&norm(sub(face,mul(x,dot(face,x))));
   const y=x&&front&&norm(cross(mul(front,-1),x));
   if(x&&front&&y)head=times(worldToTorso,col(x,y,mul(front,-1)));
  }
  raw.neck=keep('neck',head,now);
  // Fix an upright reference when the session starts, and explicitly recalibrate.
  if(!calibration)calibration=tor.y.slice();
  raw.root=fromTo(calibration,tor.y);
  if(!origin){
   origin=hip.slice();
  }
  // Horizontal movement in initial camera frame; root motion is opt-in in Lua.
  const delta=sub(hip,origin);
  const span=Math.hypot(...sub(rightShoulder,leftShoulder));
  const pose={v:2};
  for(const key of PARTS)pose[key]=raw[key].map(v=>Math.round(v*10000)/10000);
  pose.span=Number(span.toFixed(4));
  pose.strafe=Number(Math.max(-3,Math.min(3,delta[0])).toFixed(4));
  pose.adv=Number(Math.max(-3,Math.min(3,-delta[2])).toFixed(4));
  lastOutput=pose;
  return pose;
 }
 return {solve,reset,get last(){return lastOutput;}};
}
global.MrHMocapSolver={createSolver,fromTo,basis,transpose:trans,multiply:times};
})(typeof window!=='undefined'?window:globalThis);
