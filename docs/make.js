/* Mr H Animations: Uhhhhhh-only Make Animation converter interface. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const browse=$('browse-panel'),maker=$('make-panel'),moveset=$('moveset-panel'),library=$('library-movesets-panel'),bulk=$('rbxm2anim-panel'),preview=$('preview-panel'),mocap=$('mocap-panel'),themes=$('themes-panel'),plan=$('plan-panel');
const browseTab=$('tab-browse'),makeTab=$('tab-make'),movesetTab=$('tab-moveset'),libraryTab=$('tab-library-movesets'),bulkTab=$('tab-rbxm2anim'),previewTab=$('tab-preview'),mocapTab=$('tab-mocap'),themesTab=$('tab-themes'),planTab=$('tab-plan');
const form=$('make-form'),picker=$('maker-model'),music=$('maker-music');
const drop=$('maker-drop'),error=$('maker-error'),button=$('maker-convert'),status=$('maker-status');
let modelFile=null;

function tabFromHash(){
 if(location.hash==='#movesets')return 'library';
 if(location.hash==='#rbxm2anim')return 'bulk';
 if(location.hash==='#make-moveset')return 'moveset';
 if(location.hash==='#make-animation'||location.hash==='#dance-maker')return 'make';
 if(location.hash==='#3d-preview')return 'preview';
 if(location.hash==='#camera-motion')return 'mocap';
 if(location.hash==='#plan')return 'plan';
 if(location.hash==='#key-generator')return 'keygen';
 if(location.hash==='#themes')return 'themes';
 return 'browse';
}
function showTab(tab,updateUrl=true){
 if(tab==='keygen'&&$('tab-keygen').hidden)tab='plan';
 for(const [name,section,button] of [
  ['browse',browse,browseTab],['library',library,libraryTab],['make',maker,makeTab],['bulk',bulk,bulkTab],['moveset',moveset,movesetTab],['preview',preview,previewTab],['mocap',mocap,mocapTab],['themes',themes,themesTab],['plan',plan,planTab],['keygen',$('keygen-panel'),$('tab-keygen')]
 ]){
  const active=name===tab;
  section.hidden=!active;
  button.classList.toggle('active',active);
  button.setAttribute('aria-selected',String(active));
 }
 if(updateUrl)history.replaceState(null,'',tab==='library'?'#movesets':tab==='moveset'?'#make-moveset':tab==='bulk'?'#rbxm2anim':tab==='make'?'#make-animation':tab==='preview'?'#3d-preview':tab==='mocap'?'#camera-motion':tab==='plan'?'#plan':tab==='keygen'?'#key-generator':tab==='themes'?'#themes':'#browse-animations');
 window.dispatchEvent(new CustomEvent('mrh-section-change',{detail:{tab}}));
}
browseTab.addEventListener('click',()=>showTab('browse'));
libraryTab.addEventListener('click',()=>showTab('library'));
makeTab.addEventListener('click',()=>showTab('make'));
bulkTab.addEventListener('click',()=>showTab('bulk'));
movesetTab.addEventListener('click',()=>showTab('moveset'));
previewTab.addEventListener('click',()=>showTab('preview'));
mocapTab.addEventListener('click',()=>showTab('mocap'));
planTab.addEventListener('click',()=>showTab('plan'));
$('tab-keygen').addEventListener('click',()=>showTab('keygen'));
window.addEventListener('mrh-keygen-permission',e=>{
 const allowed=!!e.detail?.allowed;
 if(!allowed&&tabFromHash()==='keygen')showTab('plan');
 else if(allowed&&location.hash==='#key-generator')showTab('keygen',false);
});
themesTab.addEventListener('click',()=>showTab('themes'));
window.addEventListener('hashchange',()=>showTab(tabFromHash(),false));
showTab(tabFromHash(),false);

function invalid(message){error.textContent=message;error.hidden=!message;}
function setModel(file){
 invalid('');
 if(!file)return;
 modelFile=null;window.dispatchEvent(new CustomEvent('mrh-maker-model',{detail:{file:null}}));
 if(!/\.(anim|rbxm|rbxmx)$/i.test(file.name)){invalid('Choose an .anim track or Roblox .rbxm/.rbxmx model.');return;}
 const raw=!/\.anim$/i.test(file.name);
 if(file.size<(raw?32:8)||file.size>(raw?4:8)*1048576){invalid('Choose .anim under 8 MB or a model under 4 MB.');return;}
 modelFile=file;
 window.dispatchEvent(new CustomEvent('mrh-maker-model',{detail:{file}}));
 $('maker-file-name').textContent=file.name;
 drop.classList.add('has-file');
 if(!$('maker-name').value.trim())
  $('maker-name').value=file.name.replace(/\.(anim|rbxm|rbxmx)$/i,'').replace(/[_-]/g,' ').slice(0,80);
 status.textContent='Animation selected. Create your dance when ready.';
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
 if(!modelFile){invalid('Choose an .anim track or Roblox model.');return;}
 const audio=music.files?.[0];
 if(audio&&(!/\.mp3$/i.test(audio.name)||audio.size>25*1048576)){
  invalid('Music must be an .mp3 under 25 MB.');return;
 }
 const data=new FormData();
  try{data.set('visuals',JSON.stringify(window.MrhMakerVisuals.get('dance')));window.MrhMakerVisuals.appendFiles('dance',data)}catch(e){invalid(e.message);return}
 data.set('model',modelFile,modelFile.name);
 if(audio)data.set('music',audio,audio.name);
 data.set('name',$('maker-name').value.trim().slice(0,80));
 data.set('description',$('maker-description').value.trim());
 data.set('loop',String($('maker-loop').checked));
 button.disabled=true;button.textContent='Creating dance...';
 status.textContent='Building your dance ZIP...';
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
  status.textContent='Could not create dance. Check your animation file.';
 }finally{
  button.disabled=false;button.innerHTML='Create Dance ZIP <span>↓</span>';
 }
});
})();