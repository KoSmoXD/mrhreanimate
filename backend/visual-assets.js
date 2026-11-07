'use strict';
// Validate binary cosmetic uploads. These files are archived, never executed.
const fs=require('node:fs/promises'),path=require('node:path');
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const expectedName=(kind,n,ext)=>'MRH_'+kind+'_'+String(n).padStart(2,'0')+ext;
const allNames=settings=>[
 ...settings.effects.filter(r=>r.type==='png').map(r=>r.image),
 ...settings.accessories.filter(r=>r.model).map(r=>r.model)
];
async function head(file,size){
 if(file.buffer)return file.buffer.subarray(0,size);
 const handle=await fs.open(file.path,'r');try{const buffer=Buffer.alloc(size);await handle.read(buffer,0,size,0);return buffer}finally{await handle.close()}
}
async function validateVisualUploads(settings,files){
 const images=files?.effects||[],models=files?.accessories||[];
 const imageRules=settings.effects.filter(r=>r.type==='png'),modelRules=settings.accessories.filter(r=>r.model);
 if(images.length!==imageRules.length||models.length!==modelRules.length)throw Error('Each PNG effect and accessory model needs exactly one matching upload.');
 let total=0;const output=[];
 for(let i=0;i<images.length;i++){
  const file=images[i],name=expectedName('Effect',i+1,'.png');
  if(imageRules[i].image!==name||path.extname(file.originalname).toLowerCase()!=='.png'||file.size<24||file.size>2*1048576)
   throw Error('PNG effect uploads must be valid PNG files under 2 MB.');
  const bytes=await head(file,24);
  if(!bytes.subarray(0,8).equals(PNG)||bytes.toString('ascii',12,16)!=='IHDR')throw Error('PNG effect has an invalid file header.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>4096||height>4096)throw Error('PNG dimensions must be within 4096 x 4096.');
  total+=file.size;output.push({name,folder:'Images',file});
 }
 for(let i=0;i<models.length;i++){
  const file=models[i],ext=path.extname(file.originalname).toLowerCase();
  const name=expectedName('Accessory',i+1,ext);
  if(!['.rbxm','.rbxmx'].includes(ext)||modelRules[i].model!==name||file.size<32||file.size>4*1048576)
   throw Error('Accessory models must be .rbxm / .rbxmx files under 4 MB.');
  const bytes=await head(file,512);
  if(ext==='.rbxm'&&!bytes.subarray(0,8).toString('ascii').startsWith('<roblox!'))throw Error('Invalid binary Roblox accessory model.');
  if(ext==='.rbxmx'&&!/^\s*(?:<\?xml[^>]*>\s*)?<roblox\b/i.test(bytes.toString('utf8').replace(/^\uFEFF/,'')))throw Error('Invalid XML Roblox accessory model.');
  total+=file.size;output.push({name,folder:'Models',file});
 }
 if(total>48*1048576)throw Error('Combined cosmetic uploads must stay under 48 MB.');
 return output;
}
function archiveVisualUploads(archive,uploads){
 for(const {file,name,folder} of uploads){
  const location='UhhhhhhReanim/Content/'+folder+'/'+name;
  if(file.buffer)archive.append(file.buffer,{name:location});
  else archive.file(file.path,{name:location});
 }
}
module.exports={validateVisualUploads,archiveVisualUploads,allNames};
