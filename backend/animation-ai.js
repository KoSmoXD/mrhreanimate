'use strict';
const Motion=require('../docs/motion-core');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const vector=n=>({type:'array',items:{type:'number'},minItems:n,maxItems:n});
const schema=object({title:{type:'string'},duration:{type:'number'},frames:{type:'array',items:object({time:{type:'number'},poses:{type:'array',items:object({part:{type:'string',enum:Motion.PARTS},position:vector(3),rotation:vector(3),curve:vector(4)})}})}});
module.exports=function setup(app,{auth,rateLimit}){
 const enabled=()=>!!(process.env.OPENAI_API_KEY&&process.env.ANIMATION_AI_MODEL);
 app.get('/api/animation-ai/status',(req,res)=>res.json({enabled:enabled()}));
 app.post('/api/animation-ai/generate',auth,rateLimit({windowMs:3600000,limit:8,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false}),async(req,res)=>{
  if(!enabled())return res.status(503).json({error:'AI generation needs OPENAI_API_KEY and ANIMATION_AI_MODEL configured on the server. Manual animation editing is available.'});
  const {prompt,duration}=req.body||{};
  if(typeof prompt!=='string'||prompt.trim().length<3||prompt.length>1600||!Number.isFinite(duration)||duration<.5||duration>30)return res.status(400).json({error:'Enter a 3–1600 character motion prompt and a duration of 0.5–30 seconds.'});
  try{
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:process.env.ANIMATION_AI_MODEL,store:false,max_output_tokens:14000,instructions:'Create an expressive Roblox R6 animation as editable keyframes. Return 3–24 keyframes sorted by time, first at 0, final at exact requested duration. Include all six unique parts in EVERY frame. position is local Motor6D translation in studs, rotation is local XYZ Euler DEGREES (not radians). Neutral pose is all zero. Use moderate, anatomically sensible movement, anticipation, action, follow-through. Torso root joint axes are Roblox R6 Motor6D local axes: X lateral, Y depth, Z vertical; shoulders/hips are also joint-local axes. curve is outgoing cubic Bezier timing [x1,y1,x2,y2], X in [0,1], Y in [-2,3]. No code, only motion data. Title up to 80 characters.',input:JSON.stringify({prompt:prompt.trim(),duration}),text:{format:{type:'json_schema',name:'r6_animation',strict:true,schema}}})});
   if(!response.ok)return res.status(502).json({error:'Animation AI provider failed ('+response.status+'). Check the server model and API billing.'});
   const data=await response.json();if(data.status!=='completed')throw Error('The model did not complete the animation. Try a shorter motion.');
   const text=(data.output||[]).flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
   const clip=Motion.validate(JSON.parse(text));if(Math.abs(clip.duration-duration)>.001)throw Error('Generated duration did not match. Try again.');res.json({clip});
  }catch(e){res.status(502).json({error:e.name==='TimeoutError'?'AI generation timed out. Try a shorter motion.':'AI returned an invalid or incomplete animation. '+(e instanceof SyntaxError?'':e.message)});}
 });
};
