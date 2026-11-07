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
$('keygen-lifetime').addEventListener('change',()=>{$('keygen-days').disabled=$('keygen-lifetime').checked;});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!allowed)return;
 const count=Number($('keygen-count').value),lifetime=$('keygen-lifetime').checked,days=lifetime?null:Number($('keygen-days').value);
 if(!Number.isInteger(count)||count<1||count>10||(!lifetime&&(!Number.isInteger(days)||days<1||days>3650))){show('Choose 1–10 keys and 1–3650 days or lifetime.');return;}
 submit.disabled=true;show('Generating keys…');clear();
 try{
  const response=await fetch('/api/pro/keys',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({count,lifetime,days})});
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
