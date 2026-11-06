/* Video pose matrices -> editable R6 Motor6D keyframes. No video data is retained. */
(function(root,factory){if(typeof module==='object')module.exports=factory(require('./motion-core'));else root.MrhVideoMotion=factory(root.MrhMotion)})(globalThis,M=>{
'use strict';
const I=[1,0,0,0,1,0,0,0,1],R=[-1,0,0,0,0,1,0,1,0],L=[0,0,-1,0,1,0,1,0,0],H=[0,0,1,0,1,0,-1,0,0];
const joints=[['Torso','root',R],['Head','neck',R],['Left Arm','sh_l',L],['Right Arm','sh_r',H],['Left Leg','hip_l',L],['Right Leg','hip_r',H]];
const transpose=m=>[m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]];
function multiply(a,b){return a.map((_,n)=>{const i=Math.floor(n/3)*3,j=n%3;return a[i]*b[j]+a[i+1]*b[j+3]+a[i+2]*b[j+6]})}
function quaternion(m){
 const trace=m[0]+m[4]+m[8];let x,y,z,w,s;
 if(trace>0){s=2*Math.sqrt(trace+1);w=s/4;x=(m[7]-m[5])/s;y=(m[2]-m[6])/s;z=(m[3]-m[1])/s;}
 else if(m[0]>m[4]&&m[0]>m[8]){s=2*Math.sqrt(1+m[0]-m[4]-m[8]);w=(m[7]-m[5])/s;x=s/4;y=(m[1]+m[3])/s;z=(m[2]+m[6])/s;}
 else if(m[4]>m[8]){s=2*Math.sqrt(1+m[4]-m[0]-m[8]);w=(m[2]-m[6])/s;x=(m[1]+m[3])/s;y=s/4;z=(m[5]+m[7])/s;}
 else{s=2*Math.sqrt(1+m[8]-m[0]-m[4]);w=(m[3]-m[1])/s;x=(m[2]+m[6])/s;y=(m[5]+m[7])/s;z=s/4;}
 const q=[x,y,z,w],length=Math.hypot(...q);return length>1e-8?q.map(v=>v/length):[0,0,0,1];
}
function matrix([x,y,z,w]){return[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]}
function blend(a,b,amount){const sign=a.reduce((s,n,i)=>s+n*b[i],0)<0?-1:1;const q=a.map((n,i)=>n*(1-amount)+sign*b[i]*amount),length=Math.hypot(...q);return q.map(v=>v/length)}
function sampleTimes(start,end,fps=12){
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.5||end-start>30||![6,12,24].includes(fps))throw Error('Choose 0.5–30 seconds and a supported frame rate.');
 const count=Math.ceil((end-start)*fps);return Array.from({length:count+1},(_,i)=>start+Math.min(i/fps,end-start));
}
function buildClip(samples,duration,{title='Captured dance',smoothing='balanced'}={}){
 if(!Array.isArray(samples)||samples.length<2||samples.length>721||!Number.isFinite(duration)||duration<.5||duration>30)throw Error('Capture must contain 2–721 frames over 0.5–30 seconds.');
 let previousTime=-1;for(const s of samples){if(!s||!Number.isFinite(s.time)||s.time<0||s.time>duration+1e-6||s.time<=previousTime)throw Error('Capture times must increase within the clip.');previousTime=s.time;}
 const valid=p=>p&&joints.every(([,key])=>Array.isArray(p[key])&&p[key].length===9&&p[key].every(Number.isFinite));
 const detected=samples.filter(s=>valid(s.pose)).length;
 if(detected<2||detected/samples.length<.35)throw Error('Not enough body tracking. Try a clearer video with one full person visible.');
 const first=samples.find(s=>valid(s.pose)).pose;let last=first,previous={},angles={},gap=0,maxGap=0;
 const tau={off:0,balanced:.08,strong:.18}[smoothing];if(tau===undefined)throw Error('Invalid smoothing setting.');
 const frames=samples.map((s,i)=>{
  if(valid(s.pose)){last=s.pose;gap=0}else{gap+=i?s.time-samples[i-1].time:0;maxGap=Math.max(maxGap,gap)}
  const dt=i?s.time-samples[i-1].time:0,alpha=tau&&i?1-Math.exp(-dt/tau):1;
  return{time:s.time,poses:joints.map(([part,key,c0])=>{
   const local=multiply(multiply(transpose(c0),last[key]||I),c0),target=quaternion(local),q=previous[part]?blend(previous[part],target,alpha):target;previous[part]=q;
   let rotation=M.euler(matrix(q));if(angles[part])rotation=rotation.map((v,n)=>v+360*Math.round((angles[part][n]-v)/360));angles[part]=rotation;
   return{part,position:[0,0,0],rotation,curve:[0,0,1,1]};
  })};
 });
 frames[0].time=0;frames.at(-1).time=duration;
 const clip=M.validate({title:String(title).trim().slice(0,80)||'Captured dance',duration,frames});
 return{clip,coverage:detected/samples.length,maxGap};
}
return{sampleTimes,buildClip,quaternion,matrix,multiply,transpose};
});
