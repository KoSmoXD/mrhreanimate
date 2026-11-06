'use strict';
const Motion=require('../docs/motion-core');
module.exports=(app,{auth,requirePro,rateLimit})=>{
 const limits={maxFileBytes:100*1048576,maxDuration:30,maxFrames:721};
 app.get('/api/video-animation/access',auth,requirePro,(req,res)=>res.set('Cache-Control','no-store').json({enabled:true,...limits}));
 app.post('/api/video-animation/export',auth,requirePro,rateLimit({windowMs:15*60000,limit:20,keyGenerator:req=>req.user.id,standardHeaders:'draft-7',legacyHeaders:false}), (req,res)=>{
  let clip;try{clip=Motion.validate(req.body?.clip);if(clip.duration<.5||clip.frames.length>limits.maxFrames)throw Error('Use a 0.5–30 second clip with up to 721 keyframes.');}catch(error){return res.status(400).json({error:error.message})}
  clip.frames=clip.frames.map(({time,poses})=>({time,poses:poses.map(({part,position,rotation,curve})=>({part,position,rotation,curve}))}));
  const filename=clip.title.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70)||'captured-dance';
  res.set({'Cache-Control':'no-store','Content-Disposition':'attachment; filename="'+filename+'.anim"'}).type('application/octet-stream').send(Buffer.from(Motion.encode(clip.frames,clip.title)));
 });
};
