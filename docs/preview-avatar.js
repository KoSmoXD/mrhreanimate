/* Mr H Animations — real Roblox avatar from an authenticated 3D thumbnail.
 * Browser never receives the API key. Only vetted, server-proxied OBJ/MTL/texture
 * assets are rendered; .anim values drive approximate six-part R6 articulation.
 */
import * as THREE from '/vendor/three/build/three.module.js';

const byId=id=>document.getElementById(id);
const canvas=byId('preview-avatar-canvas');
if(canvas)boot();

async function boot(){
 const label=byId('preview-roblox-status');
 const hero=byId('preview-roblox-photo');
 const link=byId('preview-roblox-link');
 const activate=byId('preview-roblox-load');
 const fallback=byId('preview-stage');
 let renderer=null,rig=null,scene=null,camera=null;
 const target=new THREE.Vector3(0,0,0);
 const parts=['Torso','Head','Left Arm','Right Arm','Left Leg','Right Leg'];
 const pivots={Torso:[0,0,0],Head:[0,1,0],'Left Arm':[-1,.5,0],'Right Arm':[1,.5,0],'Left Leg':[-.5,-1,0],'Right Leg':[.5,-1,0]};
 const keys={};
 let latest={angle:25,tilt:15,pose:{}};
 const msg=t=>{label.textContent=t;};
 const read=async url=>{const response=await fetch(url,{credentials:'same-origin'});if(!response.ok){let err={};try{err=await response.json();}catch{}throw Error(err.error||'Network error '+response.status);}return response;};
 const text=async url=>(await read(url)).text();
 const json=async url=>(await read(url)).json();
 function inferred(name,x,y){
  const n=name.toLowerCase().replace(/[\s_-]/g,'');
  if(/head|hair|hat|face|neck/.test(n))return 'Head';
  if(/left.*arm|left.*hand/.test(n))return 'Left Arm';
  if(/right.*arm|right.*hand/.test(n))return 'Right Arm';
  if(/left.*leg|left.*foot/.test(n))return 'Left Leg';
  if(/right.*leg|right.*foot/.test(n))return 'Right Leg';
  if(/torso|upperbody|lowerbody/.test(n))return 'Torso';
  if(y>=1.25)return 'Head';
  if(y<=-0.85)return x<0?'Left Leg':'Right Leg';
  if(x<-1.05)return 'Left Arm';
  if(x>1.05)return 'Right Arm';
  return 'Torso';
 }
 function parseMtl(source,allowed){
  const loader=new THREE.TextureLoader(),result={};let current=null;
  for(const raw of source.split(/\r?\n/)){
   const line=raw.trim();if(!line||line.startsWith('#'))continue;
   const split=line.indexOf(' ');if(split<0)continue;
   const verb=line.slice(0,split),value=line.slice(split+1).trim();
   if(verb==='newmtl'){current={color:new THREE.Color('#cccccc'),map:null};result[value]=current;}
   else if(current&&verb==='Kd'){
    const c=value.split(/\s+/).map(Number);
    if(c.length===3&&c.every(v=>Number.isFinite(v)))current.color=new THREE.Color().setRGB(...c.map(v=>Math.max(0,Math.min(1,v))));
   }else if(current&&/^map_Kd$/i.test(verb)){
    const hash=value.match(/[0-9a-f]{32,64}/i)?.[0]?.toLowerCase();
    if(hash&&allowed.has(hash)){
     const map=loader.load('/api/roblox-preview/asset/'+hash,()=>render(),undefined,()=>msg('Some Roblox clothing textures did not load.'));
     map.colorSpace=THREE.SRGBColorSpace;
     current.map=map;
    }
   }
  }
  return result;
 }
 function parseObj(obj,materialText,allowed){
  const verts=[[0,0,0]],uvs=[[0,0]],faces=[];
  let material='default',objectName='',count=0;
  for(const raw of obj.split(/\r?\n/)){
   const line=raw.trim();if(!line||line[0]==='#')continue;
   const split=line.indexOf(' ');
   const op=split>=0?line.slice(0,split):line,rest=split>=0?line.slice(split+1).trim():'';
   if(op==='v'){
    const v=rest.split(/\s+/).slice(0,3).map(Number);
    if(v.length===3&&v.every(Number.isFinite))verts.push(v);
   }else if(op==='vt'){
    const uv=rest.split(/\s+/).slice(0,2).map(Number);uvs.push(uv.length===2&&uv.every(Number.isFinite)?uv:[0,0]);
   }else if(op==='usemtl')material=rest.slice(0,90);
   else if(op==='o'||op==='g')objectName=rest.slice(0,120);
   else if(op==='f'){
    const points=rest.split(/\s+/).map(v=>{
     const arr=v.split('/'),parse=(x,size)=>{const n=parseInt(x,10);return Number.isInteger(n)?(n<0?size+n:n):0;};
     return [parse(arr[0],verts.length),parse(arr[1],uvs.length)];
    });
    if(points.length<3||points.length>16)continue;
    for(let i=1;i<points.length-1;i++){
     faces.push({points:[points[0],points[i],points[i+1]],material,objectName});
     if(++count>180000)throw Error('Roblox avatar mesh exceeds the viewer triangle limit.');
    }
   }
  }
  if(!faces.length||verts.length<4)throw Error('Roblox returned an empty OBJ.');
  const bounds=new THREE.Box3();
  for(let i=1;i<verts.length;i++)bounds.expandByPoint(new THREE.Vector3(...verts[i]));
  const center=bounds.getCenter(new THREE.Vector3());
  const ySize=bounds.max.y-bounds.min.y;
  if(ySize<.1)throw Error('Invalid Roblox avatar dimensions.');
  const factor=5/ySize,coords=verts.map(v=>[(v[0]-center.x)*factor,(v[1]-center.y)*factor,(v[2]-center.z)*factor]);
  const materialProps=parseMtl(materialText,allowed);
  const bins=new Map();
  for(const f of faces){
   const points=f.points.map(p=>coords[p[0]]);
   if(points.some(p=>!p))continue;
   const x=(points[0][0]+points[1][0]+points[2][0])/3,y=(points[0][1]+points[1][1]+points[2][1])/3;
   const limb=inferred(f.objectName,x,y),key=limb+'\u0000'+f.material;
   let bin=bins.get(key);
   if(!bin){bin={limb,material:f.material,positions:[],texcoords:[]};bins.set(key,bin);}
   const pivot=pivots[limb];
   for(const p of f.points){
    const position=coords[p[0]],uv=uvs[p[1]]||[0,0];
    bin.positions.push(position[0]-pivot[0],position[1]-pivot[1],position[2]-pivot[2]);
    bin.texcoords.push(uv[0],uv[1]);
   }
  }
  const group=new THREE.Group();group.name='northkoreaplayer9';const root=new THREE.Group();root.name='Torso';group.add(root);keys.Torso=root;
  for(const name of parts.slice(1)){
   const part=new THREE.Group();part.name=name;part.position.set(...pivots[name]);root.add(part);keys[name]=part;
  }
  for(const bin of bins.values()){
   const geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.Float32BufferAttribute(bin.positions,3));
   geometry.setAttribute('uv',new THREE.Float32BufferAttribute(bin.texcoords,2));
   geometry.computeVertexNormals();
   const info=materialProps[bin.material];
   const mat=new THREE.MeshStandardMaterial({color:info?.color||0xdddddd,roughness:.94,metalness:0,map:info?.map||null,side:THREE.DoubleSide});
   const mesh=new THREE.Mesh(geometry,mat);
   mesh.frustumCulled=false;keys[bin.limb].add(mesh);
  }
  return group;
 }
 function cameraPose(){
  if(!camera)return;
  const a=latest.angle*Math.PI/180,t=latest.tilt*Math.PI/180;
  camera.position.set(Math.sin(a)*10*Math.cos(t),Math.sin(t)*10,Math.cos(a)*10*Math.cos(t));
  camera.lookAt(target);
 }
 function applyPose(){
  if(!rig)return;
  for(const name of parts){
   const p=latest.pose[name],pivot=pivots[name],bone=keys[name];
   bone.position.set(pivot[0]+(p?.p?.[0]||0),pivot[1]+(p?.p?.[1]||0),pivot[2]+(p?.p?.[2]||0));
   if(p?.r&&p.r.length===9){
    const r=p.r;
    const m=new THREE.Matrix4().set(r[0],r[1],r[2],0,r[3],r[4],r[5],0,r[6],r[7],r[8],0,0,0,0,1);
    bone.quaternion.setFromRotationMatrix(m);
   }else bone.quaternion.identity();
  }
 }
 function render(){
  if(!renderer)return;
  const rect=fallback.getBoundingClientRect();
  const width=Math.max(320,Math.round(rect.width)),height=Math.max(300,Math.round(rect.height));
  renderer.setSize(width,height,false);
  camera.aspect=width/height;camera.updateProjectionMatrix();
  cameraPose();applyPose();renderer.render(scene,camera);
 }
 function createScene(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  scene=new THREE.Scene();scene.background=new THREE.Color('#101724');
  camera=new THREE.PerspectiveCamera(36,1,.1,100);
  scene.add(new THREE.AmbientLight(0xc5d5f9,2.2));
  const light=new THREE.DirectionalLight(0xffffff,2.9);light.position.set(-4,8,6);scene.add(light);
  const floor=new THREE.Mesh(new THREE.BoxGeometry(7,.15,7),new THREE.MeshStandardMaterial({color:0x293448,roughness:1}));
  floor.position.y=-2.8;scene.add(floor);
 }
 window.addEventListener('mrh-preview-frame',e=>{
  if(!rig)return;
  latest={angle:e.detail.angle,tilt:e.detail.tilt,pose:e.detail.pose||{}};
  render();
 });
 async function loadAvatar(){
  activate.disabled=true;
  msg('Loading northkoreaplayer9’s real Roblox avatar model…');
  try{
   const manifest=await json('/api/roblox-preview/model');
   const allowed=new Set((manifest.textureHashes||[]).map(s=>s.toLowerCase()));
   const [obj,mtl]=await Promise.all([text(manifest.obj),text(manifest.mtl)]);
   const model=parseObj(obj,mtl,allowed);
   if(!renderer)createScene();
   if(rig){scene.remove(rig);rig.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
   rig=model;scene.add(rig);
   render();
   canvas.hidden=false;
   msg('Real Roblox avatar loaded — R6 animations approximate motion for non-R6 outfits.');
   activate.textContent='Reload Roblox avatar';
  }catch(e){canvas.hidden=true;msg('Cannot load the real 3D avatar: '+e.message);}
  finally{activate.disabled=false;}
 }
 activate.addEventListener('click',loadAvatar);
 try{
  const profile=await json('/api/roblox-preview/profile');
  link.textContent='@'+profile.name;
  link.href=profile.profileUrl;
  hero.src='/api/roblox-preview/portrait';
  hero.hidden=false;
  if(profile.modelAvailable)await loadAvatar();
  else msg('Avatar portrait connected. Real 3D mesh requires a Roblox Thumbnails Read API key configured on the server.');
 }catch(e){msg('Roblox profile unavailable: '+e.message);}
}
