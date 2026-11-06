(()=>{
'use strict';
const $=id=>document.getElementById(id);
let current=null,requestId=0,expiryTimer;
function render(plan){
 current=plan;clearTimeout(expiryTimer);
 const active=!!plan?.hasAccess;
 document.querySelectorAll('[data-plus-only]').forEach(tab=>tab.hidden=!active);
 $('plan-free').textContent=active?'Included with +':'Current plan';
 $('plan-activate-focus').textContent=active?'Add another key':'Activate with a key';
 $('plan-status').textContent=!plan?'Could not check your plan. Try again shortly.':active?(plan.isOwner?'Owner · + access active':plan.expiresAt?'+ active until '+new Date(plan.expiresAt).toLocaleString():'+ lifetime access active'):'Your current plan: Free';
 $('plan-login').hidden=!!plan?.loggedIn;
 $('plan-redeem').disabled=!plan?.loggedIn;
 if(active&&plan.expiresAt&&!plan.isOwner){const remaining=plan.expiresAt-Date.now();if(remaining<=0){render({...plan,hasAccess:false});return;}expiryTimer=setTimeout(refresh,Math.min(remaining+50,2147483647));}
}
async function refresh(){
 const id=++requestId;
 try{const response=await fetch('/api/pro/status',{cache:'no-store'});if(!response.ok)throw Error('Status unavailable');const plan=await response.json();if(id===requestId)render(plan);}
 catch{if(id===requestId)render(null);}
}
$('plan-activate-focus').onclick=()=>$('plan-key').focus();
$('plan-login').onclick=()=>$('login-trigger').click();
$('plan-redeem-form').onsubmit=async event=>{
 event.preventDefault();if(!current?.loggedIn){$('login-trigger').click();return;}
 $('plan-redeem').disabled=true;$('plan-result').textContent='Activating…';
 try{
  const response=await fetch('/api/pro/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:$('plan-key').value.trim()})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Activation failed.');
  ++requestId;render(result);$('plan-key').value='';$('plan-result').textContent='+ activated. Your + tabs are now unlocked.';
 }catch(error){$('plan-result').textContent=error.message;}
 finally{$('plan-redeem').disabled=!current?.loggedIn;}
};
window.addEventListener('mrh-session-change',()=>{render(null);$('plan-key').value='';$('plan-result').textContent='';refresh();});
window.addEventListener('focus',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden)refresh();},60000);
refresh();
})();
