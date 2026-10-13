/* Mr H community Movesets library and comment threads (plain text only). */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const st={user:null,items:[],total:0,search:'',busy:false,timer:null,selected:null,comments:[],commentTotal:0,loaded:false,token:0};
const displayDate=new Intl.DateTimeFormat('en-GB',{year:'numeric',month:'short',day:'2-digit'});
function node(tag,cls,content){const v=document.createElement(tag);if(cls)v.className=cls;if(content!==undefined)v.textContent=content;return v;}
function size(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?Math.round(n/1024)+' KB':n+' B';}
function date(iso){const d=new Date(iso);return Number.isNaN(d.getTime())?'Unknown':displayDate.format(d);}
function owner(u){return u?.role==='owner';}
function avatar(user,cls='avatar'){
 const host=node('span',cls,(user?.username||'?').slice(0,1).toUpperCase());
 if(user?.avatarUrl){
  const img=node('img','avatar-image');img.src=user.avatarUrl;img.alt='';img.loading='lazy';
  img.addEventListener('error',()=>{host.textContent=(user?.username||'?').slice(0,1).toUpperCase();});
  host.replaceChildren(img);
 }
 return host;
}
function author(user){
 const p=node('div','anim-author');p.append(avatar(user),node('span','author-name',user.username||'Unknown'));
 if(owner(user)){const badge=node('span','owner-badge','✅');badge.title='Verified server owner';p.append(badge);}
 return p;
}
async function request(path,options={}){
 const r=await fetch('/api'+path,{credentials:'same-origin',cache:'no-store',...options});
 let data;try{data=await r.json()}catch{data={}}
 if(!r.ok)throw Error(data.error||'Request failed ('+r.status+')');
 return data;
}
function issue(msg){const toast=$('toast');toast.textContent=msg;toast.hidden=false;toast.classList.toggle('error',true);setTimeout(()=>toast.hidden=true,4500);}
function showError(id,msg){$(id).hidden=!msg;$(id).textContent=msg||'';}
function setUser(user){st.user=user||null;$('moveset-upload-trigger').hidden=!st.user;const form=$('comment-form');const signin=$('comment-signin');if(form)form.hidden=!st.user;if(signin)signin.hidden=!!st.user;if(st.loaded)renderMovesets();if(st.selected)renderComments();}
window.addEventListener('mrh-session-change',e=>setUser(e.detail?.user));
request('/me').then(r=>setUser(r.user)).catch(()=>setUser(null));
function openDialog(id){
 document.querySelectorAll('.modal').forEach(m=>m.hidden=m.id!==id);
 $(id).hidden=false;document.body.style.overflow='hidden';
}
async function fetchMovesets(more=false){
 if(st.busy)return;st.busy=true;
 $('moveset-refresh').disabled=true;$('moveset-load-more').disabled=true;
 try{
  const data=await request('/movesets?limit=32&offset='+(more?st.items.length:0)+'&q='+encodeURIComponent(st.search));
  if(!Array.isArray(data.items))throw Error('Invalid moveset response');
  st.items=more?[...st.items,...data.items]:data.items;st.total=data.total||0;st.loaded=true;renderMovesets();
 }catch(e){$('moveset-gallery').replaceChildren(node('div','state-message','Could not load movesets. '+e.message));}
 finally{st.busy=false;$('moveset-refresh').disabled=false;$('moveset-load-more').disabled=false;}
}
function renderMovesets(){
 const gallery=$('moveset-gallery');gallery.replaceChildren();
 if(!st.items.length){gallery.append(node('div','state-message','No movesets uploaded yet. Make one using Moveset Maker, then upload the ZIP here.'));}
 for(const [i,item] of st.items.entries()){
  const card=node('article','anim-card click-card');card.tabIndex=0;card.setAttribute('role','button');
  card.setAttribute('aria-label','Open '+item.title+' moveset details and comments');
  card.style.setProperty('--card-delay',(i%12)*45+'ms');
  const inner=node('div','card-body');inner.append(node('h2','anim-title',item.title),author(item));
  if(item.description)inner.append(node('p','card-description',item.description));
  const info=node('div','card-info');
  for(const [label,value] of [['Uploaded on',date(item.createdAt)],['Size',size(item.sizeBytes)]]){
   const group=node('div');group.append(node('span','info-label',label),node('span','info-value',value));info.append(group);
  }inner.append(info);
  const actions=node('div','card-actions');
  const details=node('button','action details-button','Comments ('+(item.commentCount||0)+')');details.type='button';details.addEventListener('click',()=>open('movesets',item.id));actions.append(details);
  const download=node('a','download','Download ↓');download.href='/api/movesets/'+encodeURIComponent(item.id)+'/download';actions.append(download);
  if(st.user&&(item.userId===st.user.id||owner(st.user))){
   const del=node('button','delete-button','Delete');del.type='button';del.addEventListener('click',()=>deleteMoveset(item));actions.append(del);
  }
  card.append(inner,actions);
  card.addEventListener('click',e=>{if(!e.target.closest('a,button'))open('movesets',item.id);});
  card.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===card){e.preventDefault();open('movesets',item.id);}});
  gallery.append(card);
 }
 $('moveset-load-more').hidden=st.items.length>=st.total;
}
async function deleteMoveset(item){
 if(!confirm('Delete moveset "'+item.title+'" and all its comments?'))return;
 try{await request('/movesets/'+encodeURIComponent(item.id),{method:'DELETE'});st.selected=null;await fetchMovesets();}catch(e){issue(e.message);}
}
async function open(kind,id){
 if(!['animations','movesets'].includes(kind))return;
 const token=++st.token;
 st.selected={kind,id};st.comments=[];st.commentTotal=0;
 $('item-title').textContent='Loading...';
 $('item-owner').replaceChildren();$('item-description').textContent='';
 $('item-facts').textContent='';
 $('item-comments').replaceChildren(node('div','state-message','Loading comments...'));
 $('item-comment-count').textContent='0';
 $('comment-more').hidden=true;showError('comment-error','');$('comment-text').value='';
 $('comment-form').hidden=!st.user;$('comment-signin').hidden=!!st.user;
 openDialog('item-modal');
 try{
  const data=await request('/'+kind+'/'+encodeURIComponent(id));
  if(token!==st.token)return;
  st.selected={kind,id,item:data.item};
  $('item-title').textContent=data.item.title;
  $('item-owner').replaceChildren(author(data.item));
  $('item-description').textContent=data.item.description||'No description provided.';
  $('item-facts').textContent=(kind==='animations'?'Dance':'Moveset')+' · '+date(data.item.createdAt)+' · '+size(data.item.sizeBytes);
  $('item-download').href='/api/'+kind+'/'+encodeURIComponent(id)+'/download';
  await fetchComments(false,token);
 }catch(e){if(token===st.token)$('item-comments').replaceChildren(node('div','state-message',e.message));}
}
async function fetchComments(more=false,token=st.token){
 if(!st.selected)return;
 const {kind,id}=st.selected;
 try{
  const response=await request('/'+kind+'/'+encodeURIComponent(id)+'/comments?offset='+(more?st.comments.length:0));
  if(token!==st.token)return;
  st.comments=more?[...st.comments,...response.items]:response.items;
  st.commentTotal=response.total;renderComments();
 }catch(e){if(token===st.token)$('item-comments').replaceChildren(node('div','state-message',e.message));}
}
function renderComments(){
 if(!st.selected)return;
 const holder=$('item-comments');holder.replaceChildren();
 $('item-comment-count').textContent=String(st.commentTotal);
 if(!st.comments.length)holder.append(node('div','empty-comments','No comments yet. Be the first to comment.'));
 for(const comment of st.comments){
  const box=node('div','comment-entry');
  const head=node('div','comment-heading');
  head.append(author(comment),node('span','comment-date',date(comment.createdAt)));
  if(st.user&&(comment.userId===st.user.id||owner(st.user))){
   const del=node('button','comment-delete','Delete');del.type='button';del.addEventListener('click',()=>removeComment(comment));head.append(del);
  }
  const body=node('p','comment-body',comment.body);
  box.append(head,body);holder.append(box);
 }
 $('comment-more').hidden=st.comments.length>=st.commentTotal;
}
async function removeComment(comment){
 if(!confirm('Delete this comment?'))return;
 try{
  await request('/comments/'+encodeURIComponent(comment.id),{method:'DELETE'});
  await fetchComments(false);refreshCounts();
 }catch(e){issue(e.message);}
}
async function publishComment(e){
 e.preventDefault();if(!st.user){issue('Log in to comment.');return;}
 const selected=st.selected;if(!selected)return;
 const value=$('comment-text').value.trim();
 if(!value||[...value].length>1000){showError('comment-error','Comment must be 1–1000 characters.');return;}
 const btn=$('comment-submit');btn.disabled=true;showError('comment-error','');
 try{
  await request('/'+selected.kind+'/'+encodeURIComponent(selected.id)+'/comments',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:value})
  });
  $('comment-text').value='';await fetchComments(false);refreshCounts();
 }catch(err){showError('comment-error',err.message);}
 finally{btn.disabled=false;}
}
async function refreshCounts(){
 if(st.selected?.kind==='movesets')await fetchMovesets();
 else window.dispatchEvent(new Event('mrh-dance-comments-updated'));
}
async function publishMoveset(e){
 e.preventDefault();
 const button=$('moveset-upload-submit');button.disabled=true;showError('moveset-upload-error','');
 try{
  const data=new FormData($('moveset-upload-form'));
  const file=$('community-moveset-zip').files?.[0];
  if(!file||!/\.zip$/i.test(file.name)||file.size>50*1048576)throw Error('Choose a ZIP under 50 MB.');
  await request('/movesets',{method:'POST',body:data});
  $('moveset-upload-form').reset();
  $('moveset-upload-modal').hidden=true;
  document.body.style.overflow='';
  st.search='';$('moveset-search').value='';
  await fetchMovesets();
 }catch(err){showError('moveset-upload-error',err.message);}
 finally{button.disabled=false;}
}
$('moveset-upload-trigger').addEventListener('click',()=>openDialog('moveset-upload-modal'));
$('moveset-upload-form').addEventListener('submit',publishMoveset);
$('moveset-refresh').addEventListener('click',()=>fetchMovesets());
$('moveset-load-more').addEventListener('click',()=>fetchMovesets(true));
$('moveset-search').addEventListener('input',e=>{clearTimeout(st.timer);st.timer=setTimeout(()=>{st.search=e.target.value.trim();fetchMovesets();},260);});
$('comment-form').addEventListener('submit',publishComment);
$('comment-more').addEventListener('click',()=>fetchComments(true));
window.addEventListener('mrh-section-change',e=>{if(e.detail?.tab==='library'&&!st.loaded)fetchMovesets();});
if(location.hash==='#movesets')fetchMovesets();
window.MRHCommunity={open,refresh:fetchMovesets};
})();