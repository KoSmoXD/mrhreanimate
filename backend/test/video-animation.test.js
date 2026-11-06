'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const M=require('../../docs/motion-core'),V=require('../../docs/video-motion-core');
const identity=[1,0,0,0,1,0,0,0,1];
const pose=()=>Object.fromEntries(['root','neck','sh_l','sh_r','hip_l','hip_r'].map(k=>[k,identity.slice()]));
test('video capture samples the selected segment with exact endpoints and bounded frame counts',()=>{
 for(const fps of [6,12,24]){const times=V.sampleTimes(2,32,fps);assert.equal(times[0],2);assert.equal(times.at(-1),32);assert(times.length<=721);assert(times.every((t,i)=>!i||t>times[i-1]));}
 assert.throws(()=>V.sampleTimes(0,31,12));assert.throws(()=>V.sampleTimes(0,.2));assert.throws(()=>V.sampleTimes(0,1,60));
});
test('video joint rotations preserve R6 Motor6D axes and survive binary export',()=>{
 const p=pose();p.sh_l=M.matrix([20,40,-100]);
 const {clip}=V.buildClip([{time:0,pose:pose()},{time:1,pose:p}],1,{smoothing:'off'});
 assert.equal(clip.frames.length,2);assert(clip.frames[0].poses.every(p=>p.rotation.every(v=>Math.abs(v)<1e-8)));
 const arm=clip.frames[1].poses.find(p=>p.part==='Left Arm'),c0=[0,0,-1,0,1,0,1,0,0];
 const physical=V.multiply(V.multiply(c0,M.matrix(arm.rotation)),V.transpose(c0));physical.forEach((v,i)=>assert(Math.abs(v-p.sh_l[i])<1e-6));
 const decoded=M.parse(M.encode(clip.frames,clip.title).buffer);assert.equal(decoded.duration,1);decoded.frames[1].poses[2].rotation.forEach((v,i)=>assert(Math.abs(v-arm.rotation[i])<1e-4));
});
test('missing detections hold the last pose, while unusable footage fails instead of generating fake motion',()=>{
 assert.throws(()=>V.buildClip([{time:0,pose:null},{time:1,pose:null}],1),/Not enough/);
 const raised=pose();raised.sh_l=M.matrix([0,0,90]);
 const samples=[{time:0,pose:pose()},{time:.2,pose:raised},{time:.8,pose:null},{time:1,pose:raised}];
 const result=V.buildClip(samples,1,{smoothing:'off'});assert.equal(result.coverage,.75);assert(result.maxGap>=.6);
 assert.deepEqual(result.clip.frames[1].poses,result.clip.frames[2].poses);
 assert.throws(()=>V.buildClip([{time:0,pose:pose()},{time:0,pose:pose()}],1),/increase/);
});
test('quaternion smoothing crosses 180 degrees without flipping through a neutral pose',()=>{
 const a=pose(),b=pose();a.sh_l=M.matrix([0,0,179]);b.sh_l=M.matrix([0,0,-179]);
 const {clip}=V.buildClip([{time:0,pose:a},{time:.05,pose:b},{time:.5,pose:b}],.5,{smoothing:'strong'});
 const angle=clip.frames[1].poses.find(p=>p.part==='Left Arm').rotation;assert(Math.max(...angle.map(Math.abs))>170);assert(angle.every(Number.isFinite));
});
test('video export requires active + access, validates clips, and returns a compatible animation',async()=>{
 const app=express();app.use(express.json({limit:'2mb'}));
 require('../video-animation')(app,{auth:(req,res,next)=>req.headers['x-user']?(req.user={id:'test'},next()):res.sendStatus(401),requirePro:(req,res,next)=>req.headers['x-plus']==='yes'?next():res.sendStatus(403),rateLimit:()=> (req,res,next)=>next()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const send=(body,headers={})=>fetch(base+'/api/video-animation/export',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await fetch(base+'/api/video-animation/access')).status,401);
  assert.equal((await send({clip:M.blank()})).status,401);assert.equal((await send({clip:M.blank()},{'x-user':'test'})).status,403);
  const headers={'x-user':'test','x-plus':'yes'},r=await send({clip:M.blank()},headers);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert(r.headers.get('content-disposition').includes('.anim'));assert.equal(M.parse(await r.arrayBuffer()).duration,2);
  assert.equal((await send({clip:{duration:100}},headers)).status,400);
  assert((await(await fetch(base+'/api/video-animation/access',{headers})).json()).enabled);
 }finally{await new Promise(r=>server.close(r))}
});
