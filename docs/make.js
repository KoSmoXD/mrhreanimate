/* Mr H Animations: Uhhhhhh-only Make Animation converter interface. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const browse=$('browse-panel'),maker=$('make-panel');
const browseTab=$('tab-browse'),makeTab=$('tab-make');
const form=$('make-form'),picker=$('maker-model'),music=$('maker-music');
const drop=$('maker-drop'),error=$('maker-error'),button=$('maker-convert'),status=$('maker-status');
let modelFile=null;

function showTab(tab,updateUrl=true){
 const creating=tab==='make';
 browse.hidden=creating;maker.hidden=!creating;
 browseTab.classList.toggle('active',!creating);
 makeTab.classList.toggle('active',creating);
 browseTab.setAttribute('aria-selected',String(!creating));
 makeTab.setAttribute('aria-selected',String(creating));
 if(updateUrl)history.replaceState(null,'',creating?'#make-animation':'#browse-animations');
}
browseTab.addEventListener('click',()=>showTab('browse'));
makeTab.addEventListener('click',()=>showTab('make'));
window.addEventListener('hashchange',()=>showTab(location.hash==='#make-animation'?'make':'browse',false));
showTab(location.hash==='#make-animation'?'make':'browse',false);

function invalid(message){error.textContent=message;error.hidden=!message;}
function setModel(file){
 invalid('');
 if(!file)return;
 if(!/\.(rbxm|rbxmx)$/i.test(file.name)){invalid('Choose a Roblox .rbxm or .rbxmx KeyframeSequence.');return;}
 if(file.size<32||file.size>4*1048576){invalid('The model must be smaller than 4 MB.');return;}
 modelFile=file;
 $('maker-file-name').textContent=file.name;
 drop.classList.add('has-file');
 if(!$('maker-name').value.trim())
  $('maker-name').value=file.name.replace(/\.(rbxm|rbxmx)$/i,'').replace(/[_-]/g,' ').slice(0,80);
 status.textContent='Model selected. Convert when ready.';
}
picker.addEventListener('change',()=>setModel(picker.files?.[0]));
drop.addEventListener('click',()=>picker.click());
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();picker.click();}});
for(const event of ['dragenter','dragover']){
 drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});
}
for(const event of ['dragleave','drop']){
 drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');});
}
drop.addEventListener('drop',e=>setModel(e.dataTransfer?.files?.[0]));

function safeDownloadName(header,fallback){
 const match=header?.match(/filename="([^"]+)"/i);
 const name=match?.[1]||fallback;
 return name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,100)||'Uhhhhhh_Animation.zip';
}
async function downloadArchive(response,fallback){
 const blob=await response.blob();
 if(!blob.size)throw Error('The converter returned an empty download.');
 const filename=safeDownloadName(response.headers.get('content-disposition'),fallback);
 const objectUrl=URL.createObjectURL(blob);
 const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=filename;
 document.body.appendChild(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(objectUrl),18000);
}
form.addEventListener('submit',async e=>{
 e.preventDefault();invalid('');
 if(!modelFile){invalid('Choose a Roblox KeyframeSequence .rbxm or .rbxmx file.');return;}
 const audio=music.files?.[0];
 if(audio&&(!/\.mp3$/i.test(audio.name)||audio.size>25*1048576)){
  invalid('Music must be an .mp3 under 25 MB.');return;
 }
 const data=new FormData();
 data.set('model',modelFile,modelFile.name);
 if(audio)data.set('music',audio,audio.name);
 data.set('name',$('maker-name').value.trim().slice(0,80));
 data.set('loop',String($('maker-loop').checked));
 button.disabled=true;button.textContent='Converting animation...';
 status.textContent='Reading Roblox model and building Uhhhhhh ZIP...';
 try{
  const response=await fetch('/api/make-animation',{method:'POST',body:data,credentials:'same-origin'});
  if(!response.ok){
   const payload=await response.json().catch(()=>({}));
   throw Error(payload.error||'Conversion failed ('+response.status+').');
  }
  await downloadArchive(response,($('maker-name').value.trim()||'Uhhhhhh_Animation')+'.zip');
  status.textContent='Done. Extract the downloaded ZIP into your UhhhhhhReanim workspace.';
 }catch(err){
  invalid(err.message||'Unable to convert model.');
  status.textContent='Conversion failed. Check that your model contains a KeyframeSequence.';
 }finally{
  button.disabled=false;button.innerHTML='Convert &amp; Download ZIP <span>↓</span>';
 }
});
})();