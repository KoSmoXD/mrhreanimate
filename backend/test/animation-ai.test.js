'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express'),Motion=require('../../docs/motion-core');
test('animation documents validate joint coverage and bounds; Bezier timing and binary roundtrip',()=>{
 const clip=Motion.blank();assert.equal(Motion.validate(clip).frames.length,2);
 assert.equal(Motion.bezier([0,0,1,1],0),0);assert.equal(Motion.bezier([0,0,1,1],1),1);assert.ok(Math.abs(Motion.bezier([0,0,1,1],.3)-.3)<1e-6);
 assert.ok(Motion.bezier([.42,0,1,1],.5)<.5);
 clip.frames[1].poses[2].rotation=[25,-45,80];clip.frames[1].poses[2].position=[1,2,3];
 const bytes=Motion.encode(clip.frames,clip.title),decoded=Motion.parse(bytes.buffer);
 assert.equal(decoded.duration,2);decoded.frames[1].poses[2].rotation.forEach((v,i)=>assert.ok(Math.abs(v-clip.frames[1].poses[2].rotation[i])<1e-4));
 const bad=Motion.clone(clip);bad.frames[0].poses[1].part='Torso';assert.throws(()=>Motion.validate(bad),/six R6/);
 assert.throws(()=>Motion.parse(bytes.buffer.slice(0,25)),/Truncated/);
 const nan=Motion.clone(clip);nan.frames[0].poses[0].position[0]=NaN;assert.throws(()=>Motion.validate(nan),/position/);
});
test('AI endpoint requires auth and configuration, validates provider output, keeps credentials server-side',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY,oldModel=process.env.ANIMATION_AI_MODEL;
 const app=express();app.use(express.json());require('../animation-ai')(app,{auth:(req,res,next)=>req.headers.authorization==='test'?(req.user={id:'test'},next()):res.sendStatus(401),rateLimit:()=> (req,res,next)=>next()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port;
 const request=(path,body,auth=true)=>oldFetch(url+path,body?{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'test'}:{})},body:JSON.stringify(body)}:undefined);
 try{delete process.env.OPENAI_API_KEY;delete process.env.ANIMATION_AI_MODEL;
 assert.deepEqual(await(await request('/api/animation-ai/status')).json(),{enabled:false});
 const body={prompt:'wave hello',duration:2};assert.equal((await request('/api/animation-ai/generate',body,false)).status,401);assert.equal((await request('/api/animation-ai/generate',body)).status,503);
 process.env.OPENAI_API_KEY='test-secret';process.env.ANIMATION_AI_MODEL='test-model';
 global.fetch=async(u,opts)=>{assert.equal(u,'https://api.openai.com/v1/responses');assert.equal(opts.headers.Authorization,'Bearer test-secret');const req=JSON.parse(opts.body);assert.equal(req.text.format.type,'json_schema');return{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(Motion.blank())}]}]})}};
 const good=await request('/api/animation-ai/generate',body);assert.equal(good.status,200);assert.ok(!(await good.text()).includes('test-secret'));
 assert.equal((await request('/api/animation-ai/generate',{...body,duration:90})).status,400);
 global.fetch=async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{}'}]}]})});assert.equal((await request('/api/animation-ai/generate',body)).status,502);
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;if(oldModel===undefined)delete process.env.ANIMATION_AI_MODEL;else process.env.ANIMATION_AI_MODEL=oldModel;await new Promise(r=>server.close(r));}
});
