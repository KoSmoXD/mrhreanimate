/* Mr H Moveset Maker — client for the Uhhhhhh MOVESET generator. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const ROLES=['idle','walk','run','jump','fall','climb','sit'];
 const form=$('moveset-form'),status=$('moveset-status'),error=$('moveset-error');
 const submit=$('moveset-create');
 if(!form)return;
 function showError(message){
  error.textContent=message||'';
  error.hidden=!message;
 }
 function countReady(){
  const required=['idle','walk'].filter(k=>!!$('moveset-'+k).files?.[0]).length;
  const all=ROLES.filter(k=>!!$('moveset-'+k).files?.[0]).length;
  $('moveset-completeness').textContent=required+' / 2 required tracks uploaded · '+all+' total';
 }
 function formatSize(n){
  return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
 }
 for(const role of ROLES){
  const input=$('moveset-'+role),name=$('moveset-'+role+'-name');
  input.addEventListener('change',()=>{
   const file=input.files?.[0];
   if(file && (!/\.(anim|rbxm|rbxmx)$/i.test(file.name)||file.size>(/\.(rbxm|rbxmx)$/i.test(file.name)?4:8)*1048576)){
    showError(role.toUpperCase()+' needs .anim (8 MB), .rbxm or .rbxmx (4 MB).');
    input.value='';
   }else showError('');
   const accepted=input.files?.[0];
   name.textContent=accepted?accepted.name+' · '+formatSize(accepted.size):'Choose .rbxm / .anim';
   input.closest('.move-slot')?.classList.toggle('filled',!!accepted);
   countReady();
  });
 }
 for(const [inputId,outputId,formatter] of [
  ['moveset-fade','moveset-fade-value',n=>Number(n).toFixed(2)+'s'],
  ['moveset-run-speed','moveset-run-speed-value',n=>n+' studs/s']
 ]){
  const input=$(inputId),output=$(outputId);
  input.addEventListener('input',()=>output.textContent=formatter(input.value));
 }
 function safeFilename(disposition,fallback){
  const name=disposition?.match(/filename="([^"]+)"/)?.[1]||fallback;
  return name.replace(/[^A-Za-z0-9._ -]/g,'_').slice(0,110)||'MrH_Moveset.zip';
 }
 async function saveZip(response,fallback){
  const blob=await response.blob();
  if(!blob.size)throw Error('The server returned an empty moveset.');
  const objectURL=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=objectURL;
  a.download=safeFilename(response.headers.get('content-disposition'),fallback);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(objectURL),15000);
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();showError('');
  const name=$('moveset-name').value.trim();
  if(name.length<2||name.length>64){showError('Enter a moveset name (2–64 characters).');return;}
  const data=new FormData();
  try{data.set('visuals',JSON.stringify(window.MrhMakerVisuals.get('moveset')))}catch(e){showError(e.message);return}
  data.set('name',name);
  data.set('description',$('moveset-description').value.trim());
  data.set('fade',$('moveset-fade').value);
  data.set('runSpeed',$('moveset-run-speed').value);
  let total=0;
  for(const role of ROLES){
   const file=$('moveset-'+role).files?.[0];
   if(!file)continue;
   const raw=/\.(rbxm|rbxmx)$/i.test(file.name);
   if(!/\.(anim|rbxm|rbxmx)$/i.test(file.name)||file.size<(raw?32:8)||file.size>(raw?4:8)*1048576){
    showError(role.toUpperCase()+' needs .anim under 8 MB or .rbxm/.rbxmx under 4 MB.');return;
   }
   total+=file.size;
   data.append(role,file,file.name);
  }
  if(!data.has('idle')||!data.has('walk')){showError('Idle and Walk animation files are required (.rbxm, .rbxmx, or .anim).');return;}
  const music=$('moveset-music').files?.[0];
  if(music){
   if(!/\.mp3$/i.test(music.name)||music.size>20*1048576){
    showError('Music must be an MP3 smaller than 20 MB.');return;
   }
   total+=music.size;
   data.append('music',music,music.name);
  }
  if(total>50*1048576){showError('The entire moveset must be under 50 MB.');return;}
  submit.disabled=true;
  submit.textContent='Building moveset...';
  status.textContent='Converting Roblox models to .anim (if needed) and building the Uhhhhhh moveset ZIP...';
  try{
   const response=await fetch('/api/make-moveset',{
    method:'POST',body:data,credentials:'same-origin'
   });
   if(!response.ok){
    let responseBody={};
    try{responseBody=await response.json();}catch{}
    throw Error(responseBody.error||'Moveset generation failed ('+response.status+').');
   }
   await saveZip(response,name.replace(/[^A-Za-z0-9_-]/g,'_')+'_Moveset.zip');
   status.textContent='Moveset ready! Extract the ZIP into your UhhhhhhReanim workspace.';
  }catch(err){
   showError(err.message||'Moveset generation failed.');
   status.textContent='Generation failed. Check your animation files and try again.';
  }finally{
   submit.disabled=false;
   submit.textContent='Create Moveset ZIP ↓';
  }
 });
 countReady();
})();
