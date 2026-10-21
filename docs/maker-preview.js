/* Inline previews share the supplied R6 rig with the standalone viewer. Model scripts are never executed. */
import {makeViewer} from './r6-engine.js';
import {mountVisualPreview} from './visual-preview.js';
const M=window.MrhMotion,$=id=>document.getElementById(id),roles=['idle','walk','run','jump','fall','climb','sit'];
const cache=new WeakMap();
async function readTracks(file,signal){
 if(cache.has(file))return cache.get(file);
 const pending=(async()=>{
  if(/\.anim$/i.test(file.name)){
   if(file.size>8*1048576)throw Error('Animation must be under 8 MB.');
   return[{name:file.name,clip:M.parsePreview(await file.arrayBuffer())}];
  }
  if(!/\.(rbxm|rbxmx)$/i.test(file.name)||file.size<32||file.size>4*1048576)throw Error('Choose .anim under 8 MB or .rbxm/.rbxmx under 4 MB.');
  const data=new FormData();data.set('model',file,file.name);
  const response=await fetch('/api/preview-model',{method:'POST',body:data,credentials:'same-origin',signal});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw Error(payload.error||'Preview conversion failed ('+response.status+').');
  if(!Array.isArray(payload.tracks)||!payload.tracks.length||payload.tracks.length>20)throw Error('No animation tracks returned.');
  let total=0;
  return payload.tracks.map(t=>{if(typeof t.data!=='string'||t.data.length>12*1048576)throw Error('Invalid preview track.');const decoded=atob(t.data);total+=decoded.length;if(total>8*1048576)throw Error('Preview tracks exceed 8 MB.');const bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));return{name:String(t.name||'Animation'),clip:M.parsePreview(bytes.buffer)}});
 })();
 const tracks=await pending;cache.set(file,tracks);return tracks;
}
function makeInline(prefix,tab,musicInput){
 const root=$(prefix+'-preview'),get=s=>$(prefix+'-preview-'+s),select=get('track'),audio=get('audio');
 const st={clip:null,time:0,playing:false,active:!$(tab==='make'?'make-panel':'moveset-panel').hidden,viewer:null,viewerPromise:null,token:0,controller:null,tracks:[],file:null,musicURL:null};
 mountVisualPreview(get('canvas').parentElement,()=>st.viewer?.snapshot(),()=>({maker:prefix,state:prefix==='dance'?'dance':select.value,time:st.time,active:st.active}));
 function message(text,error=false){get('status').textContent=text;get('status').classList.toggle('error',error)}
 function controls(){get('play').disabled=!st.clip||st.clip.duration<=0;get('restart').disabled=!st.clip;get('scrub').disabled=!st.clip||st.clip.duration<=0;get('play').textContent=st.playing?'Pause':'Play'}
 function seek(t,syncMusic=true){st.time=Math.max(0,Math.min(st.clip?.duration||0,t));st.viewer?.seek(st.time);get('scrub').value=String(st.time);get('time').textContent=st.time.toFixed(2)+' / '+(st.clip?.duration||0).toFixed(2)+' s';if(syncMusic&&st.musicURL&&audio.readyState>0){try{audio.currentTime=Number.isFinite(audio.duration)?Math.min(st.time,audio.duration):st.time}catch{}}}
 function pause(){st.playing=false;audio.pause();controls()}
 async function viewer(){if(st.viewer)return st.viewer;if(!st.viewerPromise){st.viewerPromise=makeViewer(get('canvas')).then(v=>{st.viewer=v;v.active(st.active);if(st.clip)v.setClip(st.clip);v.seek(st.time);get('mode').textContent=v.mode==='software'?'R6 / SOFTWARE':'R6 / 3D';return v}).catch(e=>{st.viewerPromise=null;message('Viewer unavailable: '+e.message,true);return null})}return st.viewerPromise}
 function setClip(track){pause();st.clip=track?.clip||null;get('scrub').max=String(st.clip?.duration||1);if(st.clip)st.viewer?.setClip(st.clip);else st.viewer?.setClip({duration:0,frames:[]});seek(0);controls();if(track)message(track.name+' · '+st.clip.frames.length+' keyframes · '+st.clip.duration.toFixed(2)+'s. Ready to preview.');if(st.active)viewer()}
 async function load(file,{single=false}={}){
  const token=++st.token;st.controller?.abort();st.controller=new AbortController;st.file=file;st.tracks=[];setClip(null);
  if(!file){message('Choose an animation file to preview it here.');return}
  message(/\.anim$/i.test(file.name)?'Reading '+file.name+'…':'Converting '+file.name+' for preview…');
  try{const tracks=await readTracks(file,st.controller.signal);if(token!==st.token)return;
   if(single&&tracks.length!==1)throw Error('This movement slot needs exactly one animation. The selected model contains '+tracks.length+'.');
   st.tracks=tracks;if(prefix==='dance'){select.replaceChildren(...tracks.map((t,i)=>new Option(t.name,String(i))));select.disabled=tracks.length<2}setClip(tracks[0]);
  }catch(e){if(token!==st.token)return;message(e.name==='AbortError'?'Preview cancelled.':e.message,true)}
 }
 async function play(){if(!st.clip)return;if(st.playing){pause();return}if(st.time>=st.clip.duration)seek(0);st.playing=st.clip.duration>0;controls();if(st.musicURL&&st.playing){audio.playbackRate=Number(get('speed').value);try{await audio.play()}catch{message('Animation playing. Use the music control to enable audio.')}}}
 get('play').onclick=play;get('restart').onclick=()=>seek(0);get('scrub').oninput=e=>{pause();seek(Number(e.target.value))};get('speed').onchange=()=>audio.playbackRate=Number(get('speed').value);
 function setMusic(file){pause();if(st.musicURL)URL.revokeObjectURL(st.musicURL);st.musicURL=null;audio.removeAttribute('src');audio.hidden=true;if(file){if(!/\.mp3$/i.test(file.name)||file.size>(prefix==='moveset'?20:25)*1048576){message('Choose an MP3 within the maker’s file size limit.',true);audio.load();return}st.musicURL=URL.createObjectURL(file);audio.src=st.musicURL;audio.hidden=false;}audio.load();seek(st.time)}
 $(musicInput).addEventListener('change',()=>setMusic($(musicInput).files?.[0]));
 audio.addEventListener('loadedmetadata',()=>seek(st.time));
 audio.addEventListener('play',()=>{if(!st.clip){audio.pause();message('Choose an animation before playing music.');return}st.playing=st.clip.duration>0;seek(Math.min(audio.currentTime,st.clip.duration),false);controls()});audio.addEventListener('pause',()=>{st.playing=false;controls()});audio.addEventListener('seeking',()=>{if(st.clip)seek(audio.currentTime,false)});audio.addEventListener('error',()=>{if(st.musicURL)message('Selected music could not be played. Animation preview is still available.',true)});
 window.addEventListener('mrh-section-change',e=>{st.active=e.detail?.tab===tab;if(!st.active)pause();else viewer();st.viewer?.active(st.active)});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause()});
 window.addEventListener('pagehide',()=>{pause();st.controller?.abort();if(st.musicURL)URL.revokeObjectURL(st.musicURL);st.viewer?.dispose()},{once:true});
 let last=performance.now();function frame(now){const dt=Math.min((now-last)/1000,.1);last=now;if(st.active&&st.playing&&st.clip){let t=st.musicURL&&!audio.paused&&audio.readyState>=2?audio.currentTime:st.time+dt*Number(get('speed').value);if(t>=st.clip.duration){if(get('loop').checked&&st.clip.duration>0){t%=st.clip.duration;seek(t);if(st.musicURL)audio.play().catch(()=>{});}else{t=st.clip.duration;pause()}}seek(t,false)}requestAnimationFrame(frame)}requestAnimationFrame(frame);
 if(st.active)viewer();controls();
 return{load,setClip,select,pause,state:st};
}
const dance=makeInline('dance','make','maker-music'),moveset=makeInline('moveset','moveset','moveset-music');
window.addEventListener('mrh-maker-model',e=>{dance.select.replaceChildren(new Option('Choose an animation file first',''));dance.select.disabled=true;dance.load(e.detail?.file||null)});
dance.select.onchange=()=>dance.setClip(dance.state.tracks[Number(dance.select.value)]);
function refreshRoles(preferred){const old=preferred||moveset.select.value;const available=roles.filter(r=>$('moveset-'+r).files?.[0]);moveset.select.replaceChildren(...available.map(r=>new Option(r[0].toUpperCase()+r.slice(1),r)));moveset.select.disabled=!available.length;if(available.includes(old))moveset.select.value=old;if(!available.length)moveset.select.add(new Option('Choose a movement track first',''));moveset.load($('moveset-'+moveset.select.value)?.files?.[0]||null,{single:true})}
for(const role of roles)$('moveset-'+role).addEventListener('change',()=>refreshRoles(role));
moveset.select.onchange=()=>moveset.load($('moveset-'+moveset.select.value)?.files?.[0]||null,{single:true});
$('maker-loop').addEventListener('change',()=>{$('dance-preview-loop').checked=$('maker-loop').checked});
