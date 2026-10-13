/* RBXM2ANIM: bulk conversion of Roblox KeyframeSequence files only. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const picker=$('bulk-models'),drop=$('bulk-drop'),form=$('bulk-form');
const errors=$('bulk-error'),status=$('bulk-status'),button=$('bulk-convert');
const selection=[];
function report(message){errors.textContent=message||'';errors.hidden=!message;}
function humanSize(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
function render(){
 $('bulk-summary').textContent=selection.length+' model'+(selection.length===1?'':'s')+' selected';
 const root=$('bulk-list');root.replaceChildren();
 if(!selection.length){
  const label=document.createElement('div');label.className='make-note';label.textContent='Choose one or more Roblox model files to get started.';
  root.append(label);
 }else{
  for(const [i,file] of selection.entries()){
   const line=document.createElement('div');line.className='bulk-file';
   const fileName=document.createElement('span');fileName.textContent=file.name;fileName.title=file.name;
   const fileSize=document.createElement('small');fileSize.textContent=humanSize(file.size);
   const remove=document.createElement('button');remove.type='button';remove.className='action';remove.textContent='Remove';
   remove.setAttribute('aria-label','Remove '+file.name);
   remove.addEventListener('click',()=>{selection.splice(i,1);report('');render();});
   line.append(fileName,fileSize,remove);root.append(line);
  }
 }
}
function add(list){
 report('');
 const incoming=[...list];
 for(const file of incoming){
  if(!/\.(rbxm|rbxmx)$/i.test(file.name)){report('Only .rbxm and .rbxmx models are accepted.');continue;}
  if(file.size<32||file.size>4*1048576){report('Each Roblox model must be between 32 bytes and 4 MB.');continue;}
  if(selection.length>=12){report('Maximum 12 models per batch.');break;}
  if(selection.some(f=>f.name===file.name&&f.size===file.size&&f.lastModified===file.lastModified))continue;
  selection.push(file);
 }
 const total=selection.reduce((n,f)=>n+f.size,0);
 if(total>32*1048576)report('Combined upload exceeds 32 MB. Remove some models.');
 picker.value='';
 render();
}
drop.addEventListener('click',()=>picker.click());
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();picker.click();}});
picker.addEventListener('change',()=>add(picker.files||[]));
for(const name of ['dragenter','dragover'])drop.addEventListener(name,e=>{
 e.preventDefault();drop.classList.add('dragging');
});
for(const name of ['dragleave','drop'])drop.addEventListener(name,e=>{
 e.preventDefault();drop.classList.remove('dragging');
});
drop.addEventListener('drop',e=>add(e.dataTransfer?.files||[]));
$('bulk-clear').addEventListener('click',()=>{selection.length=0;report('');render();status.textContent='Ready to convert.';});
form.addEventListener('submit',async e=>{
 e.preventDefault();report('');
 if(!selection.length){report('Select at least one Roblox .rbxm or .rbxmx model.');return;}
 if(selection.reduce((n,f)=>n+f.size,0)>32*1048576){report('Maximum combined size is 32 MB.');return;}
 const data=new FormData();
 for(const file of selection)data.append('models',file,file.name);
 button.disabled=true;button.textContent='Converting models...';
 status.textContent='Converting '+selection.length+' model(s) into native Uhhhhhh .anim files...';
 try{
  const response=await fetch('/api/rbxm2anim/bulk',{method:'POST',body:data,credentials:'same-origin'});
  if(!response.ok){
   const payload=await response.json().catch(()=>({}));
   throw Error(payload.error||'Conversion failed ('+response.status+').');
  }
  const blob=await response.blob();
  if(!blob.size)throw Error('The server returned an empty ZIP.');
  const objectUrl=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=objectUrl;
  link.download='MrH_RBXM2ANIM_Bulk.zip';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(objectUrl),18000);
  status.textContent='Conversion complete. Downloaded ZIP contains only Uhhhhhh .anim files.';
 }catch(err){
  report(err.message||'Unable to convert selected models.');
  status.textContent='Conversion failed. Check your models contain valid KeyframeSequence animations.';
 }finally{
  button.disabled=false;
  button.innerHTML='Convert &amp; Download Animations ZIP <span>↓</span>';
 }
});
render();
})();