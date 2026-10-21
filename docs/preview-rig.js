/* Same R6 renderer as Animation Maker; adopts the user's supplied preview. */
import {makeViewer} from './r6-engine.js';
const canvas=document.getElementById('preview-avatar-canvas'),fallback=document.getElementById('preview-stage');
let viewer=null,current=null,latest=null;
function apply(detail){latest=detail;if(!viewer)return;if(detail.clip!==current){current=detail.clip;const M=window.MrhMotion;viewer.setClip(current?{duration:current.duration,frames:current.frames.map(f=>({time:f.time,poses:Object.entries(f.poses).map(([part,p])=>({part,position:p.p,rotation:M.euler(p.r),style:p.style,dir:p.dir}))}))}:{duration:0,frames:[]});}
 viewer.seek(detail.time||0);viewer.camera(detail.angle,detail.tilt);}
window.addEventListener('mrh-preview-frame',e=>apply(e.detail));
window.addEventListener('mrh-section-change',e=>viewer?.active(e.detail?.tab==='preview'));
async function boot(){try{if(viewer)return;viewer=await makeViewer(canvas);canvas.hidden=false;fallback.style.visibility='hidden';canvas.style.touchAction='none';const label=document.getElementById('preview-roblox-status');label.textContent=viewer.mode==='software'?'WebGL unavailable · R6 software fallback.':'R6 rig loaded · drag to orbit, scroll to zoom.';document.getElementById('preview-roblox-link').textContent='R6 rig';document.getElementById('preview-roblox-link').removeAttribute('href');canvas.setAttribute('aria-label','Interactive R6 animation rig');if(latest)apply(latest);}catch(e){document.getElementById('preview-roblox-status').textContent='R6 rig could not load: '+e.message;}}
document.getElementById('preview-roblox-load').addEventListener('click',boot);boot();
