import {makeViewer} from './r6-engine.js';
const M=window.MrhMotion,V=window.MrhVideoMotion,$=id=>document.getElementById(id);
const video=$('source-video'),overlay=$('video-overlay'),progress=$('capture-progress');
let allowed=false,sourceReady=false,busy=false,cancelled=false,fileURL=null,clip=null,viewer=null,tracker=null,playing=false,time=0,trimOrigin=0,metadataToken=0;
const message=(text,error=false)=>{$('capture-status').textContent=text;$('capture-status').classList.toggle('error',error)};
const inputIds=['video-file','video-title','trim-start','trim-end','capture-fps','capture-smoothing'];
function controls(){
 for(const id of inputIds)$(id).disabled=busy||((id==='trim-start'||id==='trim-end')&&!sourceReady);
 $('video-convert').disabled=busy||!allowed||!sourceReady||video.readyState<1;
 $('video-cancel').hidden=!busy;$('video-cancel').disabled=!busy||cancelled;video.controls=!busy;
 for(const id of ['result-play','result-scrub','result-edit','result-export','result-project'])$(id).disabled=busy||!clip||!allowed;
 $('result-play').textContent=playing?'Pause':'Play';
}
async function access(){
 const r=await fetch('/api/video-animation/access',{cache:'no-store'});
 if(!r.ok){allowed=false;controls();if(r.status===401||r.status===403){location.replace('./#plan');throw Error('+ access is required.')}throw Error('Could not check + access. Try again.');}
 allowed=true;$('access-notice').hidden=true;$('video-workspace').hidden=false;controls();return r.json();
}
function pause(){playing=false;video.pause();controls()}
function seek(t){time=Math.max(0,Math.min(clip?.duration||0,t));viewer?.seek(time);$('result-scrub').value=String(time);$('result-time').textContent=time.toFixed(2)+' / '+(clip?.duration||0).toFixed(2)+' s'}
function clearResult(){pause();clip=null;seek(0);$('result-summary').textContent='WAITING FOR MOTION';$('result-status').textContent='Capture a clip to preview, edit and export its keyframes.';controls()}
function withTimeout(promise,ms,text){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(text)),ms)})]).finally(()=>clearTimeout(timer))}
async function loadTracker(){
 if(!window.Pose){await withTimeout(new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/mediapipe/pose/pose.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('Could not load the body tracker. Check your connection and retry.'))};document.head.appendChild(script)}),30000,'Body tracker download timed out. Retry on a stable connection.');}
 if(typeof window.Pose!=='function')throw Error('Body tracker is unavailable in this browser.');
 const pose=new window.Pose({locateFile:file=>'/vendor/mediapipe/pose/'+file});
 pose.setOptions({modelComplexity:1,smoothLandmarks:false,enableSegmentation:false,minDetectionConfidence:.5,minTrackingConfidence:.5});return pose;
}
function seekVideo(target){
 const end=Number.isFinite(video.duration)?Math.max(0,video.duration-.002):target;target=Math.min(target,end);
 if(video.readyState>=2&&Math.abs(video.currentTime-target)<.0001)return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const finish=error=>{clearTimeout(timer);for(const name of ['seeked','loadeddata'])video.removeEventListener(name,ready);video.removeEventListener('error',fail);error?reject(error):resolve()};
  const ready=()=>{if(video.readyState>=2&&Math.abs(video.currentTime-target)<.05)finish()};
  const fail=()=>finish(Error('The browser could not decode this video. Try an MP4 with H.264 video.'));
  const timer=setTimeout(()=>finish(Error('Seeking the video timed out. Try a different video format.')),15000);
  for(const name of ['seeked','loadeddata'])video.addEventListener(name,ready);video.addEventListener('error',fail);
  try{video.currentTime=target;ready()}catch(error){finish(error)}
 });
}
const edges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function drawOverlay(landmarks){
 overlay.width=video.videoWidth||640;overlay.height=video.videoHeight||480;const c=overlay.getContext('2d');if(!c)return;c.clearRect(0,0,overlay.width,overlay.height);if(!landmarks)return;
 c.strokeStyle='#97f2bd';c.lineWidth=Math.max(2,overlay.width/220);
 for(const [a,b] of edges){const p=landmarks[a],q=landmarks[b];if(!p||!q||(p.visibility??1)<.4||(q.visibility??1)<.4)continue;c.beginPath();c.moveTo(p.x*overlay.width,p.y*overlay.height);c.lineTo(q.x*overlay.width,q.y*overlay.height);c.stroke();}
}
$('video-file').onchange=()=>{
 const token=++metadataToken,file=$('video-file').files[0];clearResult();if(fileURL)URL.revokeObjectURL(fileURL);fileURL=null;sourceReady=false;video.removeAttribute('src');video.load();drawOverlay(null);$('video-empty').hidden=false;
 if(!file){controls();return;}if(file.size>100*1048576){message('Choose a video under 100 MB.',true);controls();return;}
 if(file.type&&!file.type.startsWith('video/')){message('Choose a video file.',true);controls();return;}
 $('video-title').value=file.name.replace(/\.[^.]+$/,'').slice(0,80)||'Captured dance';
 video.onloadedmetadata=()=>{if(token!==metadataToken)return;if(!Number.isFinite(video.duration)||video.duration<.5||!video.videoWidth){message('This video needs a finite duration of at least 0.5 seconds.',true);return;}
  sourceReady=true;$('trim-start').value='0';$('trim-end').value=String(Math.min(30,Math.floor(video.duration*1000)/1000));$('trim-start').max=String(video.duration-.5);$('trim-end').max=String(video.duration);
  $('file-info').textContent=video.duration.toFixed(1)+' seconds · '+(file.size/1048576).toFixed(1)+' MB';$('video-empty').hidden=true;message('Choose a segment, then capture its motion.');controls();};
 video.onerror=()=>{if(token!==metadataToken)return;if(fileURL)URL.revokeObjectURL(fileURL);fileURL=null;sourceReady=false;message('This browser cannot play that video. Try MP4 (H.264) or WebM.',true);controls();};
 fileURL=URL.createObjectURL(file);video.src=fileURL;video.load();message('Reading video…');controls();
};
$('video-convert').onclick=async()=>{
 if(busy)return;
 const start=Number($('trim-start').value),end=Number($('trim-end').value),fps=Number($('capture-fps').value);
 let times;try{times=V.sampleTimes(start,end,fps);if(end>video.duration+.001)throw Error('The selected segment goes past the end of the video.');}catch(error){message(error.message,true);return;}
 clearResult();busy=true;cancelled=false;controls();progress.hidden=false;progress.value=0;progress.max=times.length;
 try{
  await access();message('Loading the body tracker. The first run may take a moment…');tracker=await loadTracker();if(cancelled)throw Error('Capture cancelled.');
  const solver=window.MrHMocapSolver.createSolver(),samples=[],image=document.createElement('canvas');
  const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));image.width=Math.max(1,Math.round(video.videoWidth*scale));image.height=Math.max(1,Math.round(video.videoHeight*scale));const ctx=image.getContext('2d');if(!ctx)throw Error('Canvas is unavailable in this browser.');
  let result=null;tracker.onResults(r=>{result=r});
  for(let i=0;i<times.length;i++){
   if(cancelled)throw Error('Capture cancelled.');
   await seekVideo(times[i]);if(cancelled)throw Error('Capture cancelled.');ctx.drawImage(video,0,0,image.width,image.height);result=null;
   await withTimeout(tracker.send({image}),30000,'Body tracking timed out. Try a shorter clip or lower capture detail.');if(cancelled)throw Error('Capture cancelled.');
   const relative=times[i]-start,pose=result?.poseWorldLandmarks?solver.solve(result.poseWorldLandmarks,result.poseLandmarks,relative*1000):null;
   samples.push({time:relative,pose});drawOverlay(result?.poseLandmarks);$('video-detection').textContent=pose?'BODY TRACKED':'BODY NOT VISIBLE';progress.value=i+1;
   message('Capturing '+(i+1)+' / '+times.length+' frames · '+Math.round((i+1)/times.length*100)+'%');await new Promise(resolve=>setTimeout(resolve,0));
  }
  await access();if(cancelled)throw Error('Capture cancelled.');
  const built=V.buildClip(samples,end-start,{title:$('video-title').value,smoothing:$('capture-smoothing').value});clip=built.clip;trimOrigin=start;
  $('result-scrub').max=String(clip.duration);$('result-summary').textContent=clip.frames.length+' KEYFRAMES · '+Math.round(built.coverage*100)+'% TRACKED';
  try{viewer??=await makeViewer($('video-rig'));viewer.setClip(clip);$('result-status').textContent='Drag the rig to orbit. Open in editor to refine individual joints and timing.';}catch(error){$('result-status').textContent='3D preview unavailable: '+error.message+' You can still edit or download the animation.';}
  seek(0);await seekVideo(start);drawOverlay(null);message('Motion captured.'+(built.coverage<.85||built.maxGap>.6?' Some frames were hidden or unclear; missing body poses hold the last tracked pose. Refine them in the editor.':''));
 }catch(error){message(error.message,true);if(!clip)$('video-detection').textContent='CAPTURE STOPPED';}
 finally{if(tracker){try{await tracker.close()}catch{}tracker=null;}busy=false;controls();}
};
$('video-cancel').onclick=()=>{cancelled=true;$('video-cancel').disabled=true;message('Stopping after the current frame…');};
$('result-play').onclick=async()=>{if(playing){pause();return;}if(!clip||busy)return;try{if(time>=clip.duration-.01)seek(0);await seekVideo(trimOrigin+time);await video.play();playing=true;controls()}catch(error){$('result-status').textContent='Playback: '+error.message}};
$('result-scrub').oninput=()=>{pause();seek(Number($('result-scrub').value));void seekVideo(trimOrigin+time).catch(error=>message(error.message,true));};
function save(data,name,type){const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}
function filename(){return(clip?.title||'captured-dance').replace(/[^a-zA-Z0-9_-]/g,'_')}
$('result-export').onclick=async()=>{if(!clip)return;const button=$('result-export');button.disabled=true;try{const r=await fetch('/api/video-animation/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clip})});if(!r.ok){const d=await r.json();if(r.status===401||r.status===403){allowed=false;controls()}throw Error(d.error||'Export failed.');}save(await r.arrayBuffer(),filename()+'.anim','application/octet-stream');$('result-status').textContent='Downloaded .anim. Open it in 3D Preview or use it in your moveset.';}catch(error){$('result-status').textContent=error.message}finally{button.disabled=!allowed||!clip}};
$('result-project').onclick=async()=>{if(!clip)return;try{await access();save(JSON.stringify(clip,null,2),filename()+'.json','application/json')}catch(error){message(error.message,true)}};
$('result-edit').onclick=async()=>{if(!clip)return;try{await access();sessionStorage.setItem('mrh-video-import-v1',JSON.stringify(M.validate(clip)));location.assign('./studio.html?import=video')}catch(error){message('Could not open editor: '+error.message+'. Save the editable project and import it manually.',true)}};
let lastAccess=0;function animate(now){requestAnimationFrame(animate);if(playing&&clip){seek(video.currentTime-trimOrigin);if(video.paused||video.ended||time>=clip.duration-.01)pause();}if(now-lastAccess>60000){lastAccess=now;void access().catch(error=>{cancelled=true;message(error.message,true)})}}requestAnimationFrame(animate);
window.addEventListener('pagehide',()=>{cancelled=true;video.pause();if(fileURL)URL.revokeObjectURL(fileURL);viewer?.dispose()});
void access().catch(error=>{$('access-notice').textContent=error.message;});
