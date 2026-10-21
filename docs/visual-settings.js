/* Shared declarative visual settings. No user-supplied Lua, URLs, instance paths or expressions. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.MrhVisualSettings=api})(globalThis,()=>{
'use strict';
const PARTS=['Torso','Head','Left Arm','Right Arm','Left Leg','Right Leg'],STATES=['all','dance','idle','walk','run','jump','fall','climb','sit'];
const EFFECTS=['sparkles','fire','smoke','light','trail'],BEHAVIORS=['normal','follow','orbit','spin','bob','hidden'];
const empty=()=>({version:1,effects:[],accessories:[]});
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
function number(v,min,max,label,def){v=v===undefined?def:v;if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(label+' must be '+min+'–'+max+'.');return v}
function choice(v,values,label,def){v=v===undefined?def:v;if(!values.includes(v))throw Error('Invalid '+label+'.');return v}
function name(v){if(typeof v!=='string'||!v.trim()||v.length>80||/[\x00-\x1f\x7f]/.test(v))throw Error('Use the exact accessory name (1–80 characters).');return v.trim()}
function common(v){const start=number(v.start,0,300,'Start time',0),end=v.end===undefined||v.end===null?null:number(v.end,0,300,'End time');if(end!==null&&end<=start)throw Error('End time must be after start time.');return{state:choice(v.state,STATES,'state','all'),start,end}}
function validate(input){
 if(input===undefined||input===null||input==='')return empty();
 if(typeof input==='string'){if(input.length>16000)throw Error('Visual settings are too large.');try{input=JSON.parse(input)}catch{throw Error('Invalid visual settings JSON.')}}
 if(!object(input)||input.version!==1||!Array.isArray(input.effects)||!Array.isArray(input.accessories))throw Error('Invalid visual settings document.');
 if(input.effects.length>12||input.accessories.length>8)throw Error('Use up to 12 effects and 8 accessory rules.');
 const effects=input.effects.map(v=>{if(!object(v))throw Error('Invalid effect.');const target=choice(v.target,[...PARTS,'accessory'],'effect target','Torso'),color=v.color===undefined?'#ffffff':v.color;if(typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))throw Error('Choose a valid effect color.');return{type:choice(v.type,EFFECTS,'effect','sparkles'),target,name:target==='accessory'?name(v.name):'',color:color.toLowerCase(),scale:number(v.scale,.1,10,'Effect size',1),...common(v)}});
 const keys=new Set();const accessories=input.accessories.map(v=>{if(!object(v))throw Error('Invalid accessory rule.');const named=name(v.name),timing=common(v),key=named+'\0'+timing.state;if(keys.has(key))throw Error('Use one behavior per accessory name and state.');keys.add(key);const vector=(raw,limit,label)=>{raw=raw===undefined?[0,0,0]:raw;if(!Array.isArray(raw)||raw.length!==3)throw Error(label+' needs X, Y and Z.');return raw.map(n=>number(n,-limit,limit,label))};return{name:named,behavior:choice(v.behavior,BEHAVIORS,'accessory behavior','follow'),part:choice(v.part,PARTS,'attachment part','Head'),offset:vector(v.offset,10,'Offset'),rotation:vector(v.rotation,360,'Rotation'),speed:number(v.speed,0,5,'Speed',1),distance:number(v.distance,0,10,'Radius / bob height',1),...timing}});
 const result={version:1,effects,accessories};if(JSON.stringify(result).length>16000)throw Error('Visual settings are too large.');return result;
}
function active(rule,state,time){return !!state&&(rule.state==='all'||rule.state===state)&&time>=rule.start&&(rule.end===null||time<rule.end)}
function chosen(settings,state,time){const out=new Map();for(const r of settings.accessories)if(active(r,state,time)){const prior=out.get(r.name);if(!prior||r.state!=='all')out.set(r.name,r)}return [...out.values()]}
function transform(rule,time){const p=rule.offset.slice(),r=rule.rotation.slice(),phase=Math.max(0,time-rule.start)*rule.speed*2*Math.PI;if(rule.behavior==='orbit'){p[0]+=Math.cos(phase)*rule.distance;p[2]+=Math.sin(phase)*rule.distance}if(rule.behavior==='bob')p[1]+=Math.sin(phase)*rule.distance;if(rule.behavior==='spin')r[1]+=phase*180/Math.PI;return{position:p,rotation:r}}
return{PARTS,STATES,EFFECTS,BEHAVIORS,empty,validate,active,chosen,transform};
});
