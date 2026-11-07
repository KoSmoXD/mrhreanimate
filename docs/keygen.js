/* Mr H owner-only PLUS key generator. Authorization is enforced by the server. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),form=$('keygen-form'),output=$('keygen-output'),notice=$('keygen-notice'),submit=$('keygen-submit');
let keys=[],allowed=false;
const show=message=>{notice.textContent=message;notice.hidden=!message;};
function clear(){keys=[];output.replaceChildren();$('keygen-copy').hidden=true;show('');}
function access(value){allowed=!!value;if(!allowed)clear();}
function draw(){
 output.replaceChildren();
 for(const value of keys){
  const row=document.createElement('div');row.className='keygen-key';
  const code=document.createElement('code');code.textContent=value;
  const copy=document.createElement('button');copy.type='button';copy.className='keygen-copy-one';copy.textContent='Copy';
  copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(value);copy.textContent='Copied';}catch{show('Clipboard access blocked. Select the key to copy it manually.')}});
  row.append(code,copy);output.append(row);
 }
 $('keygen-copy').hidden=!keys.length;
}
const parts=['days','hours','minutes','seconds'];
const factors={days:86400000,hours:3600000,minutes:60000,seconds:1000};
function syncLifetime(){
 const lifetime=$('keygen-lifetime').checked;
 for(const unit of parts)$('keygen-'+unit).disabled=lifetime;
}
$('keygen-lifetime').addEventListener('change',syncLifetime);
syncLifetime();
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!allowed)return;
 const count=Number($('keygen-count').value),lifetime=$('keygen-lifetime').checked;
 const values=Object.fromEntries(parts.map(unit=>[unit,Number($('keygen-'+unit).value)]));
 const ms=parts.reduce((sum,unit)=>sum+values[unit]*factors[unit],0);
 if(!Number.isInteger(count)||count<1||count>10||(!lifetime&&(!parts.every(unit=>Number.isInteger(values[unit])&&values[unit]>=0&&values[unit]<=Number($('keygen-'+unit).max))||ms<1000||ms>3650*86400000))){
  show('Choose 1–10 keys and a duration between 1 second and 3650 days, or lifetime.');return;
 }
 submit.disabled=true;clear();show('Generating keys…');
 try{
  const body={count,lifetime,...(lifetime?{}:values)};
  const response=await fetch('/api/pro/keys',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Key generation failed.');
  if(!Array.isArray(result.keys)||result.keys.length!==count)throw Error('Unexpected server response.');
  keys=result.keys;draw();show(result.keys.length+' key'+(result.keys.length===1?'':'s')+' created. Copy them now: plaintext keys are never saved and cannot be viewed again.');
 }catch(error){show(error.message||'Could not generate keys.');}finally{submit.disabled=!allowed;}
});
$('keygen-copy').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(keys.join('\n'));show('All generated keys copied. Keep them private.');}
 catch{show('Clipboard blocked. Copy each key from the list.');}
});
window.addEventListener('mrh-session-change',()=>{access(false)});
window.addEventListener('mrh-keygen-permission',event=>access(event.detail?.allowed));
if(location.hash==='#key-generator')show('Checking owner access…');
})();
