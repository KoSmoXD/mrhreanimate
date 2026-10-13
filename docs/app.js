/* Mr H Animations: public gallery with real server-side username/password accounts.
 * Served with its backend from the same origin. Nothing sensitive in localStorage.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={me:null,items:[],offset:0,limit:32,total:0,search:'',busy:false,mode:'login',timer:null};
const dateFormat=new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'2-digit'});
let toastTimeout=null;

function toast(message,error=false){
 const el=$('toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;
 clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.hidden=true,4200);
}
function errorAt(id,message){
 const el=$(id);el.textContent=message||'';el.hidden=!message;
}
function apiUrl(path){return '/api'+path;}
async function request(path,options={}){
 const response=await fetch(apiUrl(path),{credentials:'same-origin',cache:'no-store',...options});
 let body=null;
 try{body=await response.json();}catch{}
 if(!response.ok){const err=new Error(body?.error||'Request failed ('+response.status+')');err.status=response.status;throw err;}
 return body;
}
const bytes=n=>n>=1024*1024?(n/1048576).toFixed(1)+' MB':n>=1024?Math.max(1,Math.round(n/1024))+' KB':n+' B';
const avatar=name=>String(name||'?').trim().slice(0,1).toUpperCase();
const isOwner=user=>user?.role==='owner';
function avatarNode(user,cls='avatar'){
 const host=el('span',cls,avatar(user?.username));
 if(user?.avatarUrl){
  const img=el('img','avatar-image');
  img.src=user.avatarUrl;img.alt='';img.loading='lazy';
  img.addEventListener('error',()=>img.remove());
  host.replaceChildren(img);
 }
 return host;
}
function ownerBadge(user){
 if(!isOwner(user))return null;
 const badge=el('span','owner-badge','✅');
 badge.title='Verified server owner';
 badge.setAttribute('aria-label','Verified server owner');
 return badge;
}

function openModal(id){
 document.querySelectorAll('.modal').forEach(el=>el.hidden=true);
 $(id).hidden=false;
 document.body.style.overflow='hidden';
 const first=$(id).querySelector('input,button');
 if(first)first.focus();
}
function closeModal(id){
 $(id).hidden=true;
 document.body.style.overflow=document.querySelector('.modal:not([hidden])')?'hidden':'';
}
function setUser(user){
 state.me=user||null;
 const active=!!state.me;
 for(const key of ['login-trigger','register-trigger'])$(key).hidden=active;
 for(const key of ['upload-trigger','account-trigger','logout-trigger','session-label'])$(key).hidden=!active;
 if(active){
  $('session-label').textContent='@'+state.me.username+(isOwner(state.me)?' ✅':'');
  $('profile-name').textContent=state.me.username;
  $('profile-badge').hidden=!isOwner(state.me);
  $('profile-role').textContent=isOwner(state.me)?'Verified owner · Server admin':'Member account';
  const avatarBox=$('profile-avatar');
  avatarBox.replaceChildren(...avatarNode(state.me,'profile-avatar').childNodes);
  if(!avatarBox.children.length)avatarBox.textContent=avatar(state.me.username);
  $('settings-username').value=state.me.username;
  $('settings-username').readOnly=isOwner(state.me);
  $('owner-name-note').hidden=!isOwner(state.me);
  $('delete-account').hidden=isOwner(state.me);
  $('avatar-remove').disabled=!state.me.avatarUrl;
 }
}
function backendError(e){
 $('connection-warning').hidden=false;
 $('connection-warning').textContent='The animation server is not connected. Accounts, community uploads, and downloads require the backend to be deployed with persistent storage.';
 if(e?.status) $('connection-warning').textContent='Server error: '+(e.message||'Unavailable')+'. Please try again later.';
}
function el(tag,classes,text){
 const n=document.createElement(tag);
 if(classes)n.className=classes;
 if(text!==undefined)n.textContent=text;
 return n;
}
function renderCard(item,index){
 const article=el('article','anim-card');article.style.setProperty('--card-delay',(index%12)*45+'ms');
 const body=el('div','card-body');
 const title=el('h2','anim-title',item.title||'Untitled animation');
 const author=el('div','anim-author');
 const username=el('span','author-name',item.username||'Unknown');
 author.append(avatarNode(item),username);
 const verified=ownerBadge(item);if(verified)author.append(verified);
 const info=el('div','card-info');
 const uploaded=el('div'),size=el('div');
 uploaded.append(el('span','info-label','Uploaded on'),el('span','info-value',dateFormat.format(new Date(item.createdAt))));
 size.append(el('span','info-label','Size'),el('span','info-value',bytes(item.sizeBytes||0)));
 info.append(uploaded,size);
 body.append(title,author,info);
 const actions=el('div','card-actions');
 const link=el('a','download','Download ↓');link.href='/api/animations/'+encodeURIComponent(item.id)+'/download';
 link.setAttribute('aria-label','Download '+item.title+' pack');actions.append(link);
 if(state.me && (state.me.id===item.userId||isOwner(state.me))){
  const remove=el('button','delete-button','Delete');remove.type='button';
  remove.addEventListener('click',()=>deleteAnimation(item));actions.append(remove);
 }
 article.append(body,actions);return article;
}
function renderGallery(append=false){
 const holder=$('gallery');
 if(!append)holder.replaceChildren();
 const shown=state.items;
 if(!shown.length){holder.append(el('div','state-message','No animations yet. Sign in to upload the first one.'));return;}
 for(const [i,item] of shown.entries()){
  if(append&&i<state.offset)continue;
  holder.append(renderCard(item,i));
 }
 $('load-more').hidden=state.items.length>=state.total;
}
async function getGallery(more=false){
 if(state.busy)return;
 state.busy=true;
 $('refresh').disabled=true;$('load-more').disabled=true;
 const offset=more?state.items.length:0;
 try{
  const data=await request('/animations?offset='+offset+'&limit='+state.limit+'&q='+encodeURIComponent(state.search));
  if(!Array.isArray(data.items))throw Error('Invalid gallery response');
  state.items=more?[...state.items,...data.items]:data.items;
  state.total=data.total||0;state.offset=offset;
  $('connection-warning').hidden=true;
  renderGallery(false);
 }catch(e){
  if(!more){state.items=[];state.total=0;$('gallery').replaceChildren(el('div','state-message','Unable to load animations.')); }
  backendError(e);
 }finally{state.busy=false;$('refresh').disabled=false;$('load-more').disabled=false;}
}
async function getSession(){
 try{const r=await request('/me');setUser(r.user);}
 catch(e){setUser(null);if(e.status!==401)backendError(e);}
 renderGallery();
}
function authMode(mode){
 state.mode=mode;
 $('auth-title').textContent=mode==='login'?'Log in':mode==='owner'?'Claim Mr_H owner':'Create account';
 $('auth-submit').textContent=mode==='login'?'Log in':mode==='owner'?'Claim verified owner':'Sign up';
 $('auth-password').autocomplete=mode==='login'?'current-password':'new-password';
 $('auth-notice').hidden=mode==='login'||mode==='owner';
 $('owner-setup-label').hidden=mode!=='owner';
 $('owner-notice').hidden=mode!=='owner';
 $('owner-setup-key').required=mode==='owner';
 $('auth-username').readOnly=mode==='owner';
 if(mode==='owner')$('auth-username').value='Mr_H';
 else if($('auth-username').value==='Mr_H')$('auth-username').value='';
 document.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.classList.toggle('selected',btn.dataset.authTab===mode));
 errorAt('auth-error','');
}
async function submitAuth(e){
 e.preventDefault();
 const submit=$('auth-submit');submit.disabled=true;errorAt('auth-error','');
 try{
  const body={username:$('auth-username').value.trim(),password:$('auth-password').value};
  if(state.mode==='owner')body.setupKey=$('owner-setup-key').value;
  const endpoint=state.mode==='owner'?'/owner/claim':state.mode==='login'?'/login':'/register';
  const result=await request(endpoint,{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  });
  setUser(result.user);$('auth-password').value='';$('owner-setup-key').value='';closeModal('auth-modal');
  toast(state.mode==='login'?'Logged in.':state.mode==='owner'?'Verified owner account claimed.':'Account created.');
  renderGallery();
 }catch(err){errorAt('auth-error',err.message);}
 finally{submit.disabled=false;}
}
async function submitUpload(e){
 e.preventDefault();
 const submit=$('upload-submit');submit.disabled=true;errorAt('upload-error','');
 try{
  const fields=new FormData($('upload-form'));
  const result=await request('/animations',{method:'POST',body:fields});
  closeModal('upload-modal');$('upload-form').reset();updateFileLabels();
  toast('Published: '+result.animation.title);
  state.search='';$('search').value='';await getGallery();
 }catch(err){errorAt('upload-error',err.message);}
 finally{submit.disabled=false;}
}
function updateFileLabels(){
 for(const [type,input] of [['anim','upload-anim'],['mp3','upload-mp3'],['lua','upload-lua']]){
  const file=$(input).files?.[0];$(type+'-file-label').textContent=file?file.name:'Choose file';
 }
}
async function deleteAnimation(item){
 if(!confirm('Delete "'+item.title+'" for everyone?'))return;
 try{await request('/animations/'+encodeURIComponent(item.id),{method:'DELETE'});toast('Animation deleted.');await getGallery();}
 catch(e){toast(e.message,true);}
}
async function saveAccount(e){
 e.preventDefault();const submit=$('account-submit');submit.disabled=true;errorAt('account-error','');
 try{
  const payload={username:$('settings-username').value.trim(),currentPassword:$('settings-current-password').value,newPassword:$('settings-new-password').value};
  const result=await request('/me',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  setUser(result.user);$('settings-current-password').value='';$('settings-new-password').value='';
  closeModal('account-modal');toast('Account settings saved.');await getGallery();
 }catch(err){errorAt('account-error',err.message);}
 finally{submit.disabled=false;}
}

async function saveAvatar(e){
 e.preventDefault();
 if(!state.me)return;
 const input=$('avatar-input'),file=input.files?.[0];
 if(!file)return;
 errorAt('avatar-error','');
 if(file.size>2*1048576){errorAt('avatar-error','Picture must be under 2 MB.');return;}
 const button=$('avatar-upload');button.disabled=true;
 try{
  const form=new FormData();form.set('avatar',file);
  const result=await request('/me/avatar',{method:'PUT',body:form});
  setUser(result.user);input.value='';
  toast('Profile picture updated.');await getGallery();
 }catch(err){errorAt('avatar-error',err.message);}
 finally{button.disabled=false;}
}
async function removeAvatar(){
 if(!state.me||!state.me.avatarUrl)return;
 try{
  const result=await request('/me/avatar',{method:'DELETE'});
  setUser(result.user);toast('Profile picture removed.');await getGallery();
 }catch(err){errorAt('avatar-error',err.message);}
}
async function deleteAccount(){
 if(!state.me)return;
 const name=prompt('Type your username to permanently delete your account and all uploaded animations:');
 if(name!==state.me.username)return;
 const password=prompt('Enter your current password to confirm account deletion:');
 if(password===null)return;
 try{
  await request('/me',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  setUser(null);closeModal('account-modal');toast('Your account and uploads were deleted.');await getGallery();
 }catch(e){toast(e.message,true);}
}
async function logout(){
 try{await request('/logout',{method:'POST'});}
 catch(e){toast(e.message,true);return;}
 setUser(null);toast('Logged out.');renderGallery();
}
function wire(){
 $('login-trigger').addEventListener('click',()=>{authMode('login');openModal('auth-modal');});
 $('register-trigger').addEventListener('click',()=>{authMode('register');openModal('auth-modal');});
 document.querySelectorAll('[data-auth-tab]').forEach(btn=>btn.addEventListener('click',()=>authMode(btn.dataset.authTab)));
 $('upload-trigger').addEventListener('click',()=>openModal('upload-modal'));
 $('account-trigger').addEventListener('click',()=>{errorAt('account-error','');openModal('account-modal');});
 $('logout-trigger').addEventListener('click',logout);
 $('refresh').addEventListener('click',()=>getGallery());
 $('load-more').addEventListener('click',()=>getGallery(true));
 $('search').addEventListener('input',e=>{clearTimeout(state.timer);state.timer=setTimeout(()=>{state.search=e.target.value.trim();getGallery();},280);});
 $('auth-form').addEventListener('submit',submitAuth);
 $('upload-form').addEventListener('submit',submitUpload);
 $('account-form').addEventListener('submit',saveAccount);
 $('avatar-form').addEventListener('submit',saveAvatar);
 $('avatar-remove').addEventListener('click',removeAvatar);
 $('delete-account').addEventListener('click',deleteAccount);
 document.querySelectorAll('.close[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
 document.querySelectorAll('.modal').forEach(modal=>modal.addEventListener('pointerdown',e=>{if(e.target===modal)closeModal(modal.id);}));
 window.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal:not([hidden])').forEach(m=>closeModal(m.id));});
 for(const id of ['upload-anim','upload-mp3','upload-lua'])$(id).addEventListener('change',updateFileLabels);
}
wire();
getSession().then(()=>getGallery());
})();