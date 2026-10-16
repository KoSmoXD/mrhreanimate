/* Mr H webcam moveset: all camera inference is performed locally.
   Only a small six-joint rotation payload is sent to the ephemeral bridge. */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const start=$('mocap-start'),stop=$('mocap-stop'),status=$('mocap-status');
const code=$('mocap-code'),video=$('mocap-video'),canvas=$('mocap-overlay');
if(!start||!stop||!video||!canvas)return;
const ctx=canvas.getContext('2d');
const EDGES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],
 [23,24],[23,25],[25,27],[24,26],[26,28]];
const PARTS=['head','torso','leftArm','rightArm','leftLeg','rightLeg'];
let stream=null,tracker=null,running=false,session=null,pending=false,raf=0,lastSent=0,frames=0;
const clamp=(v,limit)=>Math.max(-limit,Math.min(limit,v));
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2});
function detected(lm,...ids){return ids.every(i=>lm[i]&&(lm[i].visibility??1)>0.48);}
function angle(a,b,limit=2.35){return clamp(Math.atan2(b.x-a.x,b.y-a.y),limit);}
function toPose(lm){
 if(!lm||!detected(lm,11,12,23,24,15,16,27,28,0))return null;
 const shoulder=mid(lm[11],lm[12]),hip=mid(lm[23],lm[24]);
 const t=Math.max(.07,Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y));
 const lean=clamp(Math.atan2(shoulder.x-hip.x,hip.y-shoulder.y)*0.8,0.65);
 const headTilt=clamp((lm[0].x-shoulder.x)/t*0.24,0.55);
 const arm=(s,w)=>[clamp((w.z-s.z)*1.1,1.2),0,angle(s,w)];
 const leg=(h,a)=>[clamp((a.z-h.z)*0.75,0.75),0,angle(h,a,1.2)*0.7];
 return {
  head:[0,0,headTilt],torso:[0,0,lean],
  leftArm:arm(lm[11],lm[15]),rightArm:arm(lm[12],lm[16]),
  leftLeg:leg(lm[23],lm[27]),rightLeg:leg(lm[24],lm[28])
 };
}
function overlay(lm){
 if(!ctx)return;
 const width=canvas.width=video.videoWidth||640,height=canvas.height=video.videoHeight||480;
 ctx.clearRect(0,0,width,height);
 if(!lm)return;
 ctx.strokeStyle='#b2ffca';ctx.lineWidth=Math.max(2,width/210);
 for(const [i,j] of EDGES){
  if(!detected(lm,i,j))continue;
  ctx.beginPath();ctx.moveTo(lm[i].x*width,lm[i].y*height);
  ctx.lineTo(lm[j].x*width,lm[j].y*height);ctx.stroke();
 }
 ctx.fillStyle='#f8fafc';
 for(const n of [0,11,12,13,14,15,16,23,24,25,26,27,28]){
  if(!detected(lm,n))continue;
  ctx.beginPath();ctx.arc(lm[n].x*width,lm[n].y*height,Math.max(3,width/180),0,Math.PI*2);ctx.fill();
 }
}
async function call(path,method='GET',body){
 const response=await fetch(path,{
  method,cache:'no-store',
  headers:body?{'content-type':'application/json'}:{},
  body:body?JSON.stringify(body):undefined,
  signal:AbortSignal.timeout(9500),
 });
 const result=await response.json();
 if(!response.ok)throw Error(result.error||'Server error '+response.status);
 return result;
}
async function loadTracker(){
 if(window.Pose)return;
 await new Promise((resolve,reject)=>{
  const element=document.createElement('script');
  element.src='/vendor/mediapipe/pose/pose.js';
  element.onload=resolve;element.onerror=()=>reject(Error('Local MediaPipe Pose model failed to load.'));
  document.head.appendChild(element);
 });
 if(typeof window.Pose!=='function')throw Error('Pose tracker unavailable.');
}
async function publish(pose){
 if(pending||!session)return;
 pending=true;
 try{
  await call('/api/mocap/session/'+session.code+'/frame','POST',{publisherKey:session.publisherKey,pose});
  frames++;
  if(frames%10===0)status.textContent='Tracking body · '+frames+' pose frames sent. Code expires after 30 minutes.';
 }catch(e){status.textContent='Pose relay: '+e.message;}
 finally{pending=false;}
}
function onPose(result){
 if(!running)return;
 const landmarks=result.poseLandmarks;
 overlay(landmarks);
 const mapped=toPose(landmarks);
 if(!mapped){status.textContent='Body not detected. Stand back so your head, arms and legs are visible.';return;}
 const now=performance.now();
 if(now-lastSent>170&&!pending){lastSent=now;void publish(mapped);}
}
async function loop(){
 if(!running||!tracker)return;
 try{if(video.readyState>=2)await tracker.send({image:video});}
 catch(e){status.textContent='Pose estimation error: '+e.message;}
 if(running)raf=requestAnimationFrame(loop);
}
async function stopCapture(){
 running=false;cancelAnimationFrame(raf);
 start.disabled=false;stop.disabled=true;
 if(stream){for(const track of stream.getTracks())track.stop();stream=null;}
 video.srcObject=null;
 if(tracker){try{await tracker.close();}catch{}tracker=null;}
 if(session){
  const old=session;session=null;
  try{await call('/api/mocap/session/'+old.code,'DELETE',{publisherKey:old.publisherKey});}catch{}
 }
 code.textContent='----------';
 if(ctx)ctx.clearRect(0,0,canvas.width,canvas.height);
 status.textContent='Capture stopped. No camera video was uploaded.';
}
start.addEventListener('click',async()=>{
 start.disabled=true;
 status.textContent='Requesting camera permission and loading pose model...';
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access needs HTTPS and a supported browser.');
  stream=await navigator.mediaDevices.getUserMedia({
   audio:false,video:{facingMode:'user',width:{ideal:640},height:{ideal:480}}
  });
  video.srcObject=stream;await video.play();
  await loadTracker();
  tracker=new window.Pose({locateFile:file=>'/vendor/mediapipe/pose/'+file});
  tracker.setOptions({modelComplexity:1,smoothLandmarks:true,enableSegmentation:false,
   minDetectionConfidence:.55,minTrackingConfidence:.5});
  tracker.onResults(onPose);
  session=await call('/api/mocap/session','POST',{});
  code.textContent=session.code;
  running=true;frames=0;lastSent=0;
  stop.disabled=false;
  status.textContent='Camera started. Enter the pairing code in the Camera Motion moveset.';
  raf=requestAnimationFrame(loop);
 }catch(e){status.textContent='Cannot start capture: '+e.message;await stopCapture();status.textContent='Cannot start capture: '+e.message;}
});
stop.addEventListener('click',()=>void stopCapture());
window.addEventListener('pagehide',()=>{if(running)void stopCapture();});
})();
