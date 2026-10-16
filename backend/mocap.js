'use strict';
// Temporary in-memory bridge from the user's browser camera to their reanimated rig.
// Video frames never leave the browser. Only six sets of joint Euler angles are sent.
const {Router}=require('express');
const crypto=require('node:crypto');
const router=Router();
const sessions=new Map();
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PARTS=['head','torso','leftArm','rightArm','leftLeg','rightLeg'];
const LIFETIME=30*60*1000, FRESHNESS=4000, MAX_SESSIONS=150;
const json=(res,status,obj)=>res.status(status).set('Cache-Control','no-store').json(obj);
function makeCode(){
 const bytes=crypto.randomBytes(12);
 return [...bytes].slice(0,10).map(b=>ALPHABET[b%ALPHABET.length]).join('');
}
function clean(){
 const now=Date.now();
 for(const [key,value] of sessions)if(now>=value.expiresAt)sessions.delete(key);
}
function session(code){
 if(!/^[A-HJ-NP-Z2-9]{10}$/.test(code||''))return null;
 const s=sessions.get(code);
 if(s&&s.expiresAt>Date.now())return s;
 if(s)sessions.delete(code);
 return null;
}
function authorized(s,token){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;
 const a=Buffer.from(s.publisherKey,'hex'),b=Buffer.from(token,'hex');
 return crypto.timingSafeEqual(a,b);
}
function frame(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return null;
 const result={};
 for(const part of PARTS){
  const angles=data[part];
  if(!Array.isArray(angles)||angles.length!==3)return null;
  if(!angles.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=-2.8&&v<=2.8))return null;
  result[part]=angles.map(x=>Math.round(x*1000)/1000);
 }
 return result;
}
router.post('/session',(req,res)=>{
 clean();
 if(sessions.size>=MAX_SESSIONS)return json(res,503,{error:'All live capture slots are in use.'});
 let code;
 do{code=makeCode();}while(sessions.has(code));
 const now=Date.now(),publisherKey=crypto.randomBytes(32).toString('hex');
 sessions.set(code,{publisherKey,expiresAt:now+LIFETIME,updatedAt:0,
   lastPublish:0,sequence:0,pose:null});
 return json(res,201,{code,publisherKey,expiresAt:now+LIFETIME});
});
router.post('/session/:code/frame',(req,res)=>{
 const s=session(req.params.code);
 if(!s||!authorized(s,req.body?.publisherKey))
  return json(res,404,{error:'Session expired or publisher key invalid.'});
 const pose=frame(req.body.pose);
 if(!pose)return json(res,400,{error:'Expected six valid joint-angle triplets.'});
 const now=Date.now();
 if(now-s.lastPublish<90)return json(res,429,{error:'Capture rate exceeds 10 frames per second.'});
 s.lastPublish=now;
 s.sequence++;
 s.pose=pose;
 s.updatedAt=now;
 return json(res,200,{ok:true,sequence:s.sequence});
});
router.get('/session/:code/pose',(req,res)=>{
 const s=session(req.params.code);
 if(!s)return json(res,404,{error:'Pairing code not found or expired.'});
 const fresh=s.pose&&Date.now()-s.updatedAt<FRESHNESS;
 return json(res,200,{active:Boolean(fresh),sequence:s.sequence,
   pose:fresh?s.pose:null,expiresAt:s.expiresAt});
});
router.delete('/session/:code',(req,res)=>{
 const s=session(req.params.code);
 if(!s||!authorized(s,req.body?.publisherKey))return json(res,404,{error:'Session unavailable.'});
 sessions.delete(req.params.code);
 return json(res,200,{ok:true});
});
module.exports=router;
