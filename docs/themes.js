
/* Mr H Animations / safe color-only themes, locally stored per browser. */
(()=>{
'use strict';
const KEY='mrh-animations-themes-v1';
const BASE={bg:'#050505',panel:'#0d0d0e',field:'#151516',stroke:'#39393c',text:'#f8f8f9',muted:'#a2a2a8',accent:'#f2f2f3',accentText:'#070707'};
const WARM={bg:'#faf9f6',panel:'#fffefa',field:'#f3f0eb',stroke:'#e4e0d9',text:'#302d29',muted:'#756f68',accent:'#c87451',accentText:'#fffefa'};
const PRESETS=[
 {id:'default',name:'Mr H Warm Studio',description:'Claude-inspired light workspace',colors:{...WARM}},
 {id:'midnight',name:'Midnight Classic',description:'Original dark Mr H look',colors:{...BASE}},
 {id:'cinder',name:'Cinder & Flame',description:'Ember orange',colors:{bg:'#101719',panel:'#1d2829',field:'#253235',stroke:'#4b5654',text:'#ffd7bd',muted:'#b79a88',accent:'#ff855e',accentText:'#20110b'},wallpaper:'linear-gradient(135deg,#172c31,#51251d)'},
 {id:'terminal',name:'Dos.Terminal',description:'Monochrome terminal',colors:{bg:'#050805',panel:'#070e08',field:'#0a160b',stroke:'#1e6728',text:'#2ef742',muted:'#18a62f',accent:'#19d832',accentText:'#001905'}},
 {id:'ratio',name:'Ratio v1.1.3',description:'Graphite & yellow',colors:{bg:'#1a1b1d',panel:'#242529',field:'#303238',stroke:'#57585c',text:'#e7e7e7',muted:'#aeafb2',accent:'#dadf27',accentText:'#1a1b1d'}},
 {id:'whatsdetta',name:'Whatsdetta',description:'Ocean blue',colors:{bg:'#0c171c',panel:'#14222a',field:'#1b333b',stroke:'#304f51',text:'#ebf1ee',muted:'#90b0b3',accent:'#037d65',accentText:'#e3fff8'},wallpaper:'linear-gradient(125deg,#102731,#0a4c49)'},
 {id:'rose',name:'Origins - Rose Red',description:'Deep crimson',colors:{bg:'#21040e',panel:'#330a16',field:'#4c1024',stroke:'#80223a',text:'#ffe0e6',muted:'#d6a0ae',accent:'#ff0045',accentText:'#ffffff'},wallpaper:'linear-gradient(120deg,#250009,#7e0828)'},
 {id:'feathers',name:'Red Feathers',description:'Dark cherry',colors:{bg:'#130603',panel:'#270a06',field:'#36120d',stroke:'#6b312c',text:'#ffd8cf',muted:'#b77d75',accent:'#ffb2a2',accentText:'#35110a'},wallpaper:'linear-gradient(115deg,#2b0805,#4d120b)'}
];
const $=id=>document.getElementById(id);
const HEX=/^#[a-f0-9]{6}$/i;
const validHex=v=>typeof v==='string'&&HEX.test(v);
const defaults=()=>({current:'default',installed:[],wallpaper:true});
let state=defaults();
try{
 const value=JSON.parse(localStorage.getItem(KEY)||'null');
 if(value&&typeof value==='object'){
  if(typeof value.current==='string')state.current=value.current;
  if(typeof value.wallpaper==='boolean')state.wallpaper=value.wallpaper;
  if(Array.isArray(value.installed))state.installed=value.installed.slice(0,20).map(item=>{try{return normalize(item,true)}catch{return null}}).filter(Boolean);
 }
}catch{}
function safeImage(s){
 if(typeof s!=='string'||s.length>2048||/["'();\\\x00-\x1f]/.test(s))return '';
 try{
  const u=new URL(s);
  return u.protocol==='https:'&&u.hostname?u.href:'';
 }catch{return ''}
}
function normalize(raw,withId=false){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid theme JSON.');
 const name=typeof raw.name==='string'?raw.name.trim():'';
 if(!name||name.length>64)throw Error('Theme needs a name (1–64 characters).');
 const values=raw.colors&&typeof raw.colors==='object'?raw.colors:raw;
 const sem=raw.semanticColors&&typeof raw.semanticColors==='object'?raw.semanticColors:{};
 const semantic=(key)=>{const v=sem[key];return Array.isArray(v)?v[v.length-1]:v;};
 const mapped={
  bg:semantic('BACKGROUND_PRIMARY'),panel:semantic('BACKGROUND_SECONDARY'),
  field:semantic('BACKGROUND_TERTIARY'),stroke:semantic('BACKGROUND_MODIFIER_ACCENT'),
  text:semantic('TEXT_NORMAL'),muted:semantic('TEXT_MUTED'),accent:semantic('BRAND_EXPERIMENT')
 };
 const colors={...BASE};
 let changed=0;
 for(const k of Object.keys(BASE)){
  const rawColor=values[k]===undefined?mapped[k]:values[k];
  if(rawColor===undefined)continue;
  if(!validHex(rawColor))throw Error('Invalid hex color for '+k+'.');
  colors[k]=rawColor.toLowerCase();changed++;
 }
 if(!changed)throw Error('No supported theme colors found.');
 let wallpaper='';
 if(typeof raw.wallpaper==='string')wallpaper=safeImage(raw.wallpaper);
 else if(typeof raw.backgroundImage==='string')wallpaper=safeImage(raw.backgroundImage);
 else if(typeof raw.background?.url==='string')wallpaper=safeImage(raw.background.url);
 if((raw.wallpaper||raw.backgroundImage||raw.background?.url)&&!wallpaper)throw Error('Background image must be an HTTPS URL.');
 const id=withId&&typeof raw.id==='string'&&/^custom-[a-z0-9-]{1,50}$/i.test(raw.id)?raw.id:'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 return{id,name,description:String(raw.description||'Custom theme').slice(0,80),colors,wallpaper};
}
function allThemes(){return PRESETS.concat(state.installed)}
function selected(){return allThemes().find(item=>item.id===state.current)||PRESETS[0]}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{status('Could not save themes on this device.',true)}}
function apply(){
 const theme=selected();state.current=theme.id;
 const root=document.documentElement;
 const vars={bg:'--bg',panel:'--panel',field:'--field',stroke:'--stroke',text:'--white',muted:'--muted',accent:'--theme-accent',accentText:'--theme-accent-ink'};
 for(const [k,css] of Object.entries(vars))root.style.setProperty(css,theme.colors[k]);
 root.style.setProperty('--theme-card',theme.colors.field);
 root.style.setProperty('--theme-header',theme.colors.bg);
 root.classList.toggle('mrh-claude',theme.id==='default');
 root.style.setProperty('color-scheme',theme.id==='default'?'light':'dark');
 const wallpaper=state.wallpaper?theme.wallpaper:'';
 if(wallpaper){
  const image=wallpaper.startsWith('linear-gradient(')?wallpaper:'url("'+wallpaper+'")';
  document.body.style.backgroundImage='linear-gradient(#0006,#0009),'+image;
  document.body.style.backgroundAttachment='fixed';
  document.body.style.backgroundPosition='center';
  document.body.style.backgroundSize='cover';
 }else{
  document.body.style.backgroundImage='none';
 }
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme.colors.bg);
 window.dispatchEvent(new CustomEvent('mrh-theme-change',{detail:{theme:theme.name}}));
}
function status(message,error=false){const el=$('theme-status');if(el){el.textContent=message;el.classList.toggle('error',error)}}
function elem(tag,cls,content){const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=content;return n}
function themeTile(theme){
 const tile=elem('button','theme-tile');
 tile.type='button';tile.setAttribute('aria-pressed',String(theme.id===state.current));
 const mini=elem('span','theme-mini');
 mini.style.setProperty('--mini-bg',theme.colors.bg);
 mini.style.setProperty('--mini-panel',theme.colors.panel);
 mini.style.setProperty('--mini-text',theme.colors.text);
 mini.style.setProperty('--mini-muted',theme.colors.muted);
 mini.style.setProperty('--mini-accent',theme.colors.accent);
 if(theme.wallpaper&&theme.wallpaper.startsWith('linear-gradient('))mini.style.setProperty('--mini-wallpaper',theme.wallpaper);
 mini.append(elem('span','theme-preview-dot'),elem('span','theme-preview-line'),elem('span','theme-preview-line secondary'),elem('span','theme-preview-line tertiary'),elem('span','theme-preview-bar'),elem('span','theme-preview-dot end-dot'));
 tile.append(mini,elem('span','theme-tile-name',theme.name),elem('span','theme-tile-desc',theme.description));
 if(theme.id===state.current)tile.append(elem('span','theme-check','✓'));
 tile.addEventListener('click',()=>{state.current=theme.id;apply();persist();render();status(theme.name+' applied.');});
 return tile;
}
function render(){
 if(!$('themes-panel'))return;
 $('theme-builtins').replaceChildren(...PRESETS.map(themeTile));
 const holder=$('theme-installed');
 holder.replaceChildren(...state.installed.map(themeTile));
 if(!state.installed.length)holder.append(elem('p','theme-empty','No custom themes yet. Import a JSON file or create your own below.'));
 $('theme-installed-count').textContent=state.installed.length+' installed';
 $('theme-wallpaper-toggle').checked=state.wallpaper;
 const custom=state.installed.some(t=>t.id===state.current);
 $('theme-remove').disabled=!custom;
 $('theme-export').disabled=state.current==='default';
}
function install(raw){
 const theme=normalize(raw);
 if(state.installed.length>=20)throw Error('Maximum 20 custom themes. Remove one first.');
 state.installed.push(theme);state.current=theme.id;apply();persist();render();
 status(theme.name+' installed and applied.');
}
function makeEditor(){
 const current=selected();
 $('theme-name').value=state.current==='default'?'My theme':current.name+' copy';
 for(const k of ['bg','panel','field','stroke','text','muted','accent','accentText'])$('theme-color-'+k).value=current.colors[k];
 $('theme-image').value=current.wallpaper&&!current.wallpaper.startsWith('linear-gradient(')?current.wallpaper:'';
}
function download(theme){
 const blob=new Blob([JSON.stringify({name:theme.name,description:theme.description,colors:theme.colors,wallpaper:theme.wallpaper.startsWith('https:')?theme.wallpaper:undefined},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const link=elem('a');link.href=url;link.download=theme.name.replace(/[^a-z0-9-]/gi,'_').slice(0,60)+'.theme.json';
 document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function fetchTheme(url){
 let parsed;
 try{parsed=new URL(url)}catch{throw Error('Enter a valid HTTPS JSON link.')}
 if(parsed.protocol!=='https:')throw Error('Only HTTPS theme links are supported.');
 const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),10000);
 try{
  const response=await fetch(parsed.href,{signal:ctrl.signal,credentials:'omit',redirect:'follow'});
  if(!response.ok)throw Error('Theme download failed ('+response.status+').');
  if(Number(response.headers.get('content-length'))>65536)throw Error('Theme exceeds 64 KB.');
  const data=await response.text();
  if(data.length>65536)throw Error('Theme exceeds 64 KB.');
  try{return JSON.parse(data)}catch{throw Error('The link did not return valid JSON.')}
 }catch(err){if(err.name==='AbortError')throw Error('Theme download timed out.');throw err}
 finally{clearTimeout(timer)}
}
function wire(){
 if(!$('themes-panel'))return;
 render();
 $('theme-wallpaper-toggle').addEventListener('change',e=>{state.wallpaper=e.target.checked;apply();persist();});
 $('theme-url-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=$('theme-install-url');button.disabled=true;status('Downloading theme…');
  try{install(await fetchTheme($('theme-json-url').value.trim()))}
  catch(err){status(err.message+' The host must allow cross-origin access (CORS).',true)}
  finally{button.disabled=false}
 });
 $('theme-json-file').addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  try{
   if(file.size>65536)throw Error('Theme JSON must be under 64 KB.');
   install(JSON.parse(await file.text()));
  }catch(err){status(err.message,true)}
 });
 $('theme-paste').addEventListener('click',async()=>{
  try{$('theme-json-url').value=await navigator.clipboard.readText();status('Link pasted.')}
  catch{$('theme-json-url').focus();status('Paste your link into the field.')}
 });
 $('theme-editor-use').addEventListener('click',()=>{makeEditor();$('theme-name').focus();status('Current colors copied into the editor.');});
 $('theme-builder').addEventListener('submit',e=>{
  e.preventDefault();const colors={};
  for(const k of Object.keys(BASE))colors[k]=$('theme-color-'+k).value;
  try{install({name:$('theme-name').value,colors,wallpaper:$('theme-image').value.trim(),description:'Made in Mr H Animations'});}
  catch(err){status(err.message,true)}
 });
 $('theme-remove').addEventListener('click',()=>{
  const theme=selected();if(!state.installed.some(t=>t.id===theme.id))return;
  if(!confirm('Remove '+theme.name+' from this browser?'))return;
  state.installed=state.installed.filter(t=>t.id!==theme.id);state.current='default';apply();persist();render();status('Theme removed.');
 });
 $('theme-clear').addEventListener('click',()=>{
  if(!confirm('Remove all imported themes and restore default colors?'))return;
  state=defaults();apply();persist();render();makeEditor();status('Installed themes cleared.');
 });
 $('theme-export').addEventListener('click',()=>download(selected()));
 makeEditor();
}
if(!allThemes().some(t=>t.id===state.current))state.current='default';
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{apply();wire()},{once:true});
else{apply();wire()}
window.MRHThemes={getCurrent:()=>selected().name,applyPreset:id=>{if(PRESETS.some(t=>t.id===id)){state.current=id;apply();persist();render();return true}return false}};
})();
