'use strict';
/* Roblox's 3D thumbnails are authenticated since March 2026.
 * Credentials stay in ROBLOX_THUMBNAILS_API_KEY on Railway, never in the browser.
 * Only the configured avatar is fetched; this is not a generic Roblox CDN proxy.
 */
const {Router}=require('express');
const FIXED_USERNAME='northkoreaplayer9';
const API_KEY=String(process.env.ROBLOX_THUMBNAILS_API_KEY||'').trim();
const router=Router();
const caches={profile:null,portrait:null,model:null,assets:new Set()};
const MAX_AVATAR_ASSET=12*1024*1024;
const now=()=>Date.now();
function failure(res,status,message){return res.status(status).json({error:message});}
async function request(url,options={},maxBytes=1024*1024){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8500);
 try{
  const response=await fetch(url,{redirect:'error',signal:abort.signal,headers:{'Accept':'application/json',...options.headers},method:options.method||'GET',body:options.body});
  if(!response.ok){const error=new Error('Roblox returned HTTP '+response.status);error.status=response.status;throw error;}
  if(Number(response.headers.get('content-length')||0)>maxBytes)throw Error('Roblox response too large.');
  const chunks=[];let used=0;
  for await(const chunk of response.body){used+=chunk.length;if(used>maxBytes)throw Error('Roblox response too large.');chunks.push(chunk);}
  return {buffer:Buffer.concat(chunks),mime:response.headers.get('content-type')||''};
 }finally{clearTimeout(timer);}
}
async function json(url,options){const data=await request(url,options);return JSON.parse(data.buffer.toString('utf8'));}
async function profile(){
 if(caches.profile&&now()-caches.profile.at<30*60*1000)return caches.profile.value;
 const lookup=await json('https://users.roblox.com/v1/usernames/users',{method:'POST',body:JSON.stringify({usernames:[FIXED_USERNAME],excludeBannedUsers:true}),headers:{'Content-Type':'application/json'}});
 const user=Array.isArray(lookup.data)?lookup.data.find(v=>v.name?.toLowerCase()===FIXED_USERNAME):null;
 if(!user||!Number.isSafeInteger(user.id)||user.id<=0)throw Error('Roblox account not found.');
 const value={name:user.name,displayName:user.displayName||user.name,userId:user.id,profileUrl:'https://www.roblox.com/users/'+user.id+'/profile',modelAvailable:Boolean(API_KEY)};
 caches.profile={value,at:now()};
 return value;
}
function hashUrl(hash){
 if(!/^[a-f0-9]{32,64}$/i.test(hash))throw Error('Invalid asset hash.');
 let num=31;
 for(const c of hash.slice(0,32))num^=c.charCodeAt(0);
 return 'https://t'+(num%8)+'.rbxcdn.com/'+hash.toLowerCase();
}
async function model(){
 if(!API_KEY){const e=new Error('A Roblox Thumbnails Read API key must be configured in Railway before real 3D avatar meshes can load.');e.status=503;throw e;}
 if(caches.model&&now()-caches.model.at<15*60*1000)return caches.model.value;
 const id=(await profile()).userId;
 const resp=await json('https://thumbnails.roblox.com/v1/users/avatar-3d?userId='+id,{headers:{'x-api-key':API_KEY}});
 if(resp.state!=='Completed'||typeof resp.imageUrl!=='string'){
  const e=new Error('Roblox 3D avatar is not ready (state: '+String(resp.state||'unknown').slice(0,20)+').');
  e.status=503;throw e;
 }
 if(!/^https:\/\/(?:t[0-7]|tr)\.rbxcdn\.com\/[a-f0-9]{32,64}$/i.test(resp.imageUrl))throw Error('Unexpected Roblox avatar manifest URL.');
 const metadata=await json(resp.imageUrl);
 if(!/^[a-f0-9]{32,64}$/i.test(metadata.obj||'')||!/^[a-f0-9]{32,64}$/i.test(metadata.mtl||''))throw Error('Roblox avatar manifest has no OBJ/MTL geometry.');
 const hashes=[metadata.obj,metadata.mtl,...(Array.isArray(metadata.textures)?metadata.textures:[])];
 if(hashes.length>60||hashes.some(h=>!/^[a-f0-9]{32,64}$/i.test(h)))throw Error('Invalid Roblox mesh or texture hashes.');
 caches.assets=new Set(hashes.map(h=>h.toLowerCase()));
 const prefix='/api/roblox-preview/asset/';
 const value={userId:id,format:'obj',obj:prefix+metadata.obj,mtl:prefix+metadata.mtl,textureBase:prefix,textureHashes:metadata.textures||[],box:metadata.aabb||null};
 caches.model={value,at:now()};
 return value;
}
router.get('/profile',async(req,res)=>{
 try{res.set('Cache-Control','no-store');res.json(await profile());}
 catch(e){failure(res,502,'Cannot resolve Roblox username: '+e.message);}
});
router.get('/portrait',async(req,res)=>{
 try{
  if(caches.portrait&&now()-caches.portrait.at<30*60*1000){res.type(caches.portrait.mime).set('Cache-Control','public,max-age=300').send(caches.portrait.body);return;}
  const user=await profile(),list=await json('https://thumbnails.roblox.com/v1/users/avatar?userIds='+user.userId+'&size=420x420&format=Png&isCircular=false');
  const url=list.data?.[0]?.imageUrl;
  if(typeof url!=='string'||!/^https:\/\/(?:tr|t[0-7])\.rbxcdn\.com\/[a-zA-Z0-9/._-]{10,220}$/.test(url))throw Error('Roblox avatar portrait unavailable.');
  const image=await request(url,{headers:{Accept:'image/png,image/jpeg,image/webp'}},3*1024*1024);
  const mime=/image\/(png|jpeg|webp)/i.exec(image.mime)?.[0]||'image/png';
  caches.portrait={at:now(),body:image.buffer,mime};
  res.type(mime).set('Cache-Control','public,max-age=300').send(image.buffer);
 }catch(e){failure(res,502,'Avatar portrait unavailable: '+e.message);}
});
router.get('/model',async(req,res)=>{
 try{res.set('Cache-Control','no-store').json(await model());}
 catch(e){failure(res,e.status===503?503:e.status===401||e.status===403?502:502,e.message);}
});
router.get('/asset/:hash',async(req,res)=>{
 const hash=req.params.hash.toLowerCase();
 if(!/^[a-f0-9]{32,64}$/.test(hash)||!caches.assets.has(hash))return failure(res,404,'Unknown Roblox avatar asset.');
 try{
  const asset=await request(hashUrl(hash),{headers:{Accept:'*/*'}},MAX_AVATAR_ASSET);
  const mime=/^image\/(png|jpeg|webp)/i.test(asset.mime)?asset.mime.split(';')[0]:'text/plain';
  // OBJ/MTL plaintext data. Material texture maps reference other allowlisted hashes.
  res.set('Cache-Control','private,max-age=120').type(mime).send(asset.buffer);
 }catch(e){failure(res,502,'Could not load Roblox avatar asset.');}
});
module.exports=router;
