'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function solver(){
 const window={};
 const code=fs.readFileSync(path.join(__dirname,'../../docs/mocap-solver.js'),'utf8');
 vm.runInNewContext(code,{window,Date,Math,Number,Array,Object});
 return window.MrHMocapSolver.createSolver();
}
function landmarks(){
 const world=Array.from({length:33},()=>({x:0,y:0,z:0}));
 const normalized=Array.from({length:33},()=>({visibility:1}));
 const set=(index,x,y,z=0)=>{world[index]={x,y,z};};
 set(0,0,1.83,-.19);
 set(7,-.10,1.83,0);set(8,.10,1.83,0);
 set(11,-.25,1.5,0);set(12,.25,1.5,0);
 set(15,-.25,.85,0);set(16,.25,.85,0);
 set(23,-.16,1,0);set(24,.16,1,0);
 set(27,-.16,.25,0);set(28,.16,.25,0);
 return {world,normalized};
}
function identity(m){return [0,4,8].every(i=>Math.abs(m[i]-1)<.05) &&
 m.filter((v,i)=>![0,4,8].includes(i)).every(v=>Math.abs(v)<.05);}
function validRotation(m){
 assert.equal(m.length,9);
 for(let row=0;row<3;row++){
  const a=m.slice(row*3,row*3+3);
  assert.ok(Math.abs(a.reduce((s,n)=>s+n*n,0)-1)<.04);
 }
}
test('3D R6 matrix solver: neutral arms are approximately identity',()=>{
 const t=solver(),{world,normalized}=landmarks();
 const pose=t.solve(world,normalized,1000);
 assert.equal(pose.v,2);
 for(const key of ['neck','sh_l','sh_r','hip_l','hip_r','root'])validRotation(pose[key]);
 assert.ok(identity(pose.sh_l),'left shoulder points down at rest');
 assert.ok(identity(pose.sh_r),'right shoulder points down at rest');
 assert.ok(identity(pose.root),'upright torso has no root rotation');
 assert.ok(typeof pose.strafe==='number'&&typeof pose.adv==='number');
});
test('raising one arm produces a valid rotated shoulder and holds when occluded',()=>{
 const t=solver(),{world,normalized}=landmarks();
 t.solve(world,normalized,1000);
 world[15]={x:-.25,y:2.0,z:0};
 const raised=t.solve(world,normalized,1100);
 assert.ok(!identity(raised.sh_l),'raising left arm rotates the left shoulder');
 assert.ok(identity(raised.sh_r),'right arm stays in its neutral pose');
 normalized[15].visibility=.1;
 const held=t.solve(world,normalized,1200);
 assert.deepEqual(Array.from(held.sh_l),Array.from(raised.sh_l),'occluded wrist retains last stable rotation');
});
test('solver recalibration clears previous pose and rejects incomplete landmarks',()=>{
 const t=solver(),data=landmarks();
 assert.ok(t.solve(data.world,data.normalized));
 t.reset();
 const shifted=landmarks();
 shifted.world[11].x=shifted.world[12].x;
 assert.equal(t.solve(shifted.world,shifted.normalized),null,'invalid shoulder basis must fail');
});
