'use strict';
const Motion=require('../docs/motion-core');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const vector=n=>({type:'array',items:{type:'number'},minItems:n,maxItems:n});
const schema=object({title:{type:'string'},duration:{type:'number'},frames:{type:'array',items:object({time:{type:'number'},poses:{type:'array',items:object({part:{type:'string',enum:Motion.PARTS},position:vector(3),rotation:vector(3),curve:vector(4)})}})}});
const instructions="Create an expressive Roblox R6 animation as editable keyframes. Return 3\u201324 keyframes sorted by time, first at 0, final at exact requested duration. Include all six unique parts in EVERY frame. position is local Motor6D translation in studs, rotation is local XYZ Euler DEGREES (not radians). Neutral pose is all zero. Use moderate, anatomically sensible movement, anticipation, action, follow-through. Torso root joint axes are Roblox R6 Motor6D local axes: X lateral, Y depth, Z vertical; shoulders/hips are also joint-local axes. curve is outgoing cubic Bezier timing [x1,y1,x2,y2], X in [0,1], Y in [-2,3]. No code, only motion data. Title up to 80 characters.";
const providers=['openai','anthropic','gemini'];
module.exports=function setup(app,{auth,rateLimit,requirePro=(req,res,next)=>next(),proStatus=()=>({required:false,priceRobux:15,lifetime:true,checkoutReady:false})}){
 const enabled=()=>!!(process.env.OPENAI_API_KEY&&process.env.ANIMATION_AI_MODEL);
 app.get('/api/animation-ai/status',(req,res)=>res.set('Cache-Control','no-store').json({enabled:enabled(),providers,pro:proStatus(req)}));
 app.post('/api/animation-ai/generate',auth,requirePro,rateLimit({windowMs:3600000,limit:8,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false}),async(req,res)=>{
  res.set('Cache-Control','no-store');
  const personal=Object.hasOwn(req.body||{},'apiKey');
  const provider=personal?req.body.provider:'openai';
  let key=personal?req.body.apiKey:process.env.OPENAI_API_KEY;
  const model=personal?req.body.model:process.env.ANIMATION_AI_MODEL;
  // Do not retain credentials on the request object or persist them.
  if(req.body)delete req.body.apiKey;
  if(!personal&&!enabled())return res.status(503).json({error:'Choose an AI provider and enter your own API key and model. Manual editing is available.'});
  if(!providers.includes(provider))return res.status(400).json({error:'Choose OpenAI, Claude (Anthropic), or Gemini. Keys must match the provider.'});
  if(typeof key!=='string'||key.length<8||key.length>4096||/[\r\n]/.test(key))return res.status(400).json({error:'Enter a valid API key for the selected provider.'});
  if(typeof model!=='string'||!model.length||model.length>160||!/^[A-Za-z0-9._:/-]+$/.test(model))return res.status(400).json({error:'Enter a valid model ID from your provider.'});
  const {prompt,duration}=req.body||{};
  if(typeof prompt!=='string'||prompt.trim().length<3||prompt.length>1600||!Number.isFinite(duration)||duration<.5||duration>30)return res.status(400).json({error:'Enter a 3–1600 character motion prompt and a duration of 0.5–30 seconds.'});
  try{
   const input=JSON.stringify({prompt:prompt.trim(),duration});
   let url,headers={'Content-Type':'application/json'},body;
   if(provider==='openai'){
    url='https://api.openai.com/v1/responses';headers.Authorization='Bearer '+key;
    body={model,store:false,max_output_tokens:14000,instructions,input,text:{format:{type:'json_schema',name:'r6_animation',strict:true,schema}}};
   }else if(provider==='anthropic'){
    url='https://api.anthropic.com/v1/messages';headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
    body={model,max_tokens:14000,system:instructions+' JSON schema: '+JSON.stringify(schema),messages:[{role:'user',content:input}]};
   }else{
    url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model.replace(/^models\//,''))+':generateContent';headers['x-goog-api-key']=key;
    body={systemInstruction:{parts:[{text:instructions+' JSON schema: '+JSON.stringify(schema)}]},contents:[{role:'user',parts:[{text:input}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:14000}};
   }
   const response=await fetch(url,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify(body)});
   if(!response.ok){const messages={401:'API key rejected. Check your key and selected provider.',403:'Provider denied access. Check model permissions.',404:'Model not found. Check the model ID.',429:'Provider quota or rate limit reached. Check your AI account billing.'};return res.status(502).json({error:messages[response.status]||'AI provider request failed ('+response.status+'). Check your model and API account.'});}
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
   const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
   const clip=Motion.validate(JSON.parse(cleaned));if(Math.abs(clip.duration-duration)>.001)throw Error('Wrong duration');
   res.json({clip});
  }catch(e){res.status(502).json({error:e.name==='TimeoutError'?'AI generation timed out. Try a shorter motion.':'AI request failed or returned incomplete animation data. Check model support or try a shorter prompt.'});}
  finally{key=null;}
 });
};
