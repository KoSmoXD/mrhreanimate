'use strict';
const crypto=require('node:crypto');
const Motion=require('../docs/motion-core');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const vector=n=>({type:'array',items:{type:'number'},minItems:n,maxItems:n});
const schema=object({title:{type:'string'},duration:{type:'number'},frames:{type:'array',items:object({time:{type:'number'},poses:{type:'array',items:object({part:{type:'string',enum:Motion.PARTS},position:vector(3),rotation:vector(3),curve:vector(4)})}})}});
// Compact output avoids unnecessarily long inference times and large incomplete provider responses.
const instructions="Create an expressive Roblox R6 animation as editable keyframes. Return 3–12 keyframes sorted by time, first at 0, final at exact requested duration. Include all six unique parts in EVERY frame. position is local Motor6D translation in studs, rotation is local XYZ Euler DEGREES (not radians). Neutral pose is all zero. Use moderate, anatomically sensible movement, anticipation, action, follow-through. Torso root joint axes are Roblox R6 Motor6D local axes: X lateral, Y depth, Z vertical; shoulders/hips are also joint-local axes. curve is outgoing cubic Bezier timing [x1,y1,x2,y2], X in [0,1], Y in [-2,3]. Use concise JSON, no code, only motion data. Title up to 80 characters.";
const providers=['openai','anthropic','gemini'];
const MAX_PROVIDER_MS=210000;
const STATUS_TTL_MS=10*60000;
const jobs=new Map();
const fail=(code,message)=>Object.assign(new Error(message),{httpStatus:code});
function cleanError(e){
 if(e?.name==='TimeoutError')return 'The AI provider took too long to respond. Try a shorter motion or another model.';
 if(e?.name==='AbortError'||e?.message==='Cancelled')return 'Generation cancelled.';
 return e?.publicMessage||'AI request failed or returned incomplete animation data. Check model support or try a shorter prompt.';
}
function validateInput(body,env){
 const personal=Object.hasOwn(body||{},'apiKey');
 const provider=personal?body.provider:'openai';
 const key=personal?body.apiKey:env.OPENAI_API_KEY;
 const model=personal?body.model:env.ANIMATION_AI_MODEL;
 if(body)delete body.apiKey;
 if(!personal&&!(env.OPENAI_API_KEY&&env.ANIMATION_AI_MODEL))throw fail(503,'Choose an AI provider and enter your own API key and model. Manual editing is available.');
 if(!providers.includes(provider))throw fail(400,'Choose OpenAI, Claude (Anthropic), or Gemini. Keys must match the provider.');
 if(typeof key!=='string'||key.length<8||key.length>4096||/[\r\n]/.test(key))throw fail(400,'Enter a valid API key for the selected provider.');
 if(typeof model!=='string'||!model.length||model.length>160||!/^[A-Za-z0-9._:/-]+$/.test(model))throw fail(400,'Enter a valid model ID from your provider.');
 const {prompt,duration}=body||{};
 if(typeof prompt!=='string'||prompt.trim().length<3||prompt.length>1600||!Number.isFinite(duration)||duration<.5||duration>30)
  throw fail(400,'Enter a 3–1600 character motion prompt and a duration of 0.5–30 seconds.');
 return{provider,key,model,prompt:prompt.trim(),duration};
}
async function generate(params,signal,onStep=()=>{}){
 const {provider,key,model,prompt,duration}=params;
 const input=JSON.stringify({prompt,duration});
 let url,headers={'Content-Type':'application/json'},body;
 if(provider==='openai'){
  url='https://api.openai.com/v1/responses';headers.Authorization='Bearer '+key;
  body={model,store:false,max_output_tokens:9000,instructions,input,text:{format:{type:'json_schema',name:'r6_animation',strict:true,schema}}};
 }else if(provider==='anthropic'){
  url='https://api.anthropic.com/v1/messages';headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
  body={model,max_tokens:9000,system:instructions+' JSON schema: '+JSON.stringify(schema),messages:[{role:'user',content:input}]};
 }else{
  url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model.replace(/^models\//,''))+':generateContent';headers['x-goog-api-key']=key;
  body={systemInstruction:{parts:[{text:instructions+' JSON schema: '+JSON.stringify(schema)}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:9000}};
 }
 // This timeout covers the provider only. The browser polls short status requests.
 const response=await fetch(url,{method:'POST',headers,redirect:'error',signal,body:JSON.stringify(body)});
 if(!response.ok){
  const messages={401:'API key rejected. Check your key and selected provider.',403:'Provider denied access. Check model permissions.',404:'Model not found. Check the model ID.',429:'Provider quota or rate limit reached. Check your AI account billing.'};
  const error=new Error('Provider error');error.publicMessage=messages[response.status]||'AI provider request failed ('+response.status+'). Check your model and API account.';throw error;
 }
 onStep('validating');
 const data=await response.json();let text;
 if(provider==='openai'){
  if(data.status!=='completed')throw Error('Incomplete response');
  text=(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
 }else if(provider==='anthropic'){
  if(data.stop_reason!=='end_turn')throw Error('Incomplete response');
  text=(data.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('');
 }else{
  const candidate=data.candidates?.[0];if(candidate?.finishReason!=='STOP')throw Error('Incomplete response');
  text=(candidate.content?.parts||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
 }
 if(typeof text!=='string'||!text.trim())throw Error('Empty provider result');
 const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const clip=Motion.validate(JSON.parse(cleaned));if(Math.abs(clip.duration-duration)>.001)throw Error('Wrong duration');
 return clip;
}
module.exports=function setup(app,{auth,rateLimit,requirePro=(req,res,next)=>next(),proStatus=()=>({required:false})}){
 const enabled=()=>!!(process.env.OPENAI_API_KEY&&process.env.ANIMATION_AI_MODEL);
 const limiter=rateLimit({windowMs:3600000,limit:8,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false});
 app.get('/api/animation-ai/status',(req,res)=>res.set('Cache-Control','no-store').json({enabled:enabled(),providers,pro:proStatus(req)}));
 const prune=()=>{const now=Date.now();for(const [id,job] of jobs)if(['complete','error','cancelled'].includes(job.status)&&now-job.updatedAt>STATUS_TTL_MS)jobs.delete(id);};
 const sweeper=setInterval(prune,60000);sweeper.unref?.();
 function present(job){return {jobId:job.id,status:job.status,startedAt:job.startedAt,...(job.status==='complete'?{clip:job.clip}:{}),...(job.status==='error'?{error:job.error}:{})};}
 function startJob(user,params){
  const id=crypto.randomUUID(),controller=new AbortController();
  const job={id,userId:user.id,status:'queued',startedAt:Date.now(),updatedAt:Date.now(),controller};
  jobs.set(id,job);
  // Keep the upstream request alive independently of a browser/proxy connection.
  setImmediate(async()=>{
   if(job.status==='cancelled')return;
   job.status='generating';job.updatedAt=Date.now();
   let timeout;
   try{
    timeout=setTimeout(()=>controller.abort(Object.assign(new Error('AI request timeout'),{name:'TimeoutError'})),MAX_PROVIDER_MS);
    timeout.unref?.();
    const clip=await generate(params,controller.signal,step=>{if(job.status!=='cancelled'){job.status=step;job.updatedAt=Date.now();}});
    if(job.status!=='cancelled'){job.clip=clip;job.status='complete';job.updatedAt=Date.now();}
   }catch(e){
    if(job.status!=='cancelled'){
     job.status='error';job.error=controller.signal.reason?.name==='TimeoutError'?cleanError(controller.signal.reason):cleanError(e);job.updatedAt=Date.now();
    }
   }finally{clearTimeout(timeout);params.key=null;delete job.controller;}
  });
  return job;
 }
 app.post('/api/animation-ai/jobs',auth,requirePro,limiter,(req,res)=>{
  res.set('Cache-Control','no-store');
  prune();
  if([...jobs.values()].some(j=>j.userId===req.user.id&&['queued','generating','validating'].includes(j.status)))
   return res.status(409).json({error:'You already have an AI animation generating. Finish or cancel it before starting another.'});
  if([...jobs.values()].filter(j=>['queued','generating','validating'].includes(j.status)).length>=4)
   return res.status(503).json({error:'AI generation is busy. Please try again shortly.'});
  let params;try{params=validateInput(req.body,process.env)}catch(e){return res.status(e.httpStatus||400).json({error:e.message});}
  const job=startJob(req.user,params);
  res.status(202).json({jobId:job.id,status:job.status,pollAfterMs:2000});
 });
 app.get('/api/animation-ai/jobs/:id',auth,requirePro,(req,res)=>{
  res.set('Cache-Control','no-store');prune();
  const job=jobs.get(req.params.id);
  if(!job||job.userId!==req.user.id)return res.status(404).json({error:'Generation job not found or expired. Please generate again.'});
  res.json(present(job));
 });
 // Owners of a job may cancel it even after PLUS expires, avoiding unnecessary AI usage.
 app.delete('/api/animation-ai/jobs/:id',auth,(req,res)=>{
  res.set('Cache-Control','no-store');
  const job=jobs.get(req.params.id);
  if(!job||job.userId!==req.user.id)return res.status(404).json({error:'Generation job not found.'});
  if(['queued','generating','validating'].includes(job.status)){
   job.status='cancelled';job.updatedAt=Date.now();
   job.controller?.abort();
  }
  res.json(present(job));
 });
 // Keep legacy endpoint for existing clients and integrations. New studio uses background jobs.
 app.post('/api/animation-ai/generate',auth,requirePro,limiter,async(req,res)=>{
  res.set('Cache-Control','no-store');
  let params;try{params=validateInput(req.body,process.env)}catch(e){return res.status(e.httpStatus||400).json({error:e.message});}
  try{const clip=await generate(params,AbortSignal.timeout(90000));res.json({clip});}
  catch(e){res.status(502).json({error:cleanError(e)});}
  finally{params.key=null;}
 });
};
