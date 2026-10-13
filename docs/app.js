/* Mr H Animations — browser-local animation pack uploader.
 * Required: .anim + .mp3 + .lua. No remote service or code execution.
 * Exports a standards-compliant ZIP (stored entries, CRC32) without dependencies.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const EXT = {anim:'.anim',mp3:'.mp3',lua:'.lua'};
  const MAX = {anim:8*1024*1024,mp3:35*1024*1024,lua:2*1024*1024};
  const MAX_TOTAL = 48 * 1024 * 1024;
  const STORE = 'mrh-animation-packs';
  const state = {files:{anim:null,mp3:null,lua:null},id:null,db:null,saved:[],audioUrl:null,animationInfo:null,busy:false};
  const enc = new TextEncoder(),dec = new TextDecoder();
  let skipAutofill = false;

  function toast(text,isError=false){
    const item=document.createElement('div');item.className='toast'+(isError?' error':'');item.textContent=String(text);
    $('toast-stack').appendChild(item);setTimeout(()=>item.remove(),4300);
  }
  function status(message){$('status-line').textContent=message;}
  const formatBytes=n=>n>=1024*1024?(n/1024/1024).toFixed(2)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
  const trim=s=>String(s||'').trim();
  function safeFileName(name){return (trim(name).replace(/[\/\\]/g,'_').replace(/[^\w.\- ()]/g,'_').slice(0,110)||'animation');}
  function safeZipFileName(name){return safeFileName(name).replace(/^\.+/,'_');}
  function zipName(title){return (trim(title).replace(/[^\w\- ]/g,'_').replace(/\s+/g,'_').slice(0,65)||'MrH_Animation')+'.zip';}
  function allPresent(){return Object.keys(EXT).every(key=>!!state.files[key]);}
  function totalBytes(){return Object.values(state.files).reduce((n,f)=>n+(f?f.size:0),0);}
  function generatedId(){
    return globalThis.crypto && typeof crypto.randomUUID==='function'
      ? crypto.randomUUID() : 'mrh-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  }
  function titleOfFile(name){return String(name||'').replace(/\.[^.]+$/,'').replace(/[_-]/g,' ').trim().slice(0,80);}
  function details(){return {
    title:trim($('pack-title').value)||state.animationInfo?.name||'Unnamed animation',
    author:trim($('pack-author').value),
    notes:trim($('pack-notes').value),
  };}
  function updateView(){
    let count=0;
    for(const key of Object.keys(EXT)){
      const file=state.files[key],element=$('pick-'+key),label=$(key+'-name');
      element.classList.toggle('loaded',Boolean(file));
      if(file)count++;
      label.textContent=file?file.name+' · '+formatBytes(file.size):'Choose an '+EXT[key]+' file';
      $(key+'-indicator').textContent=file?'✓':'↑';
      const sum=$('summary-'+key);
      sum.textContent=file?'Added':'Missing';
      sum.classList.toggle('complete',Boolean(file));
    }
    $('file-progress').textContent=count+' / 3 FILES';
    $('download-pack').disabled=!allPresent()||state.busy;
    $('save-pack').disabled=!allPresent()||state.busy;
    $('workspace-name').textContent=trim($('pack-title').value)||'New animation pack';
    $('audio-label').textContent=state.files.mp3?state.files.mp3.name:'NO MP3 SELECTED';
    $('storage-note').textContent=state.db?'Local browser storage':'Downloads available; storage unavailable';
  }
  function resetAudio(){
    const audio=$('music-preview');
    try{audio.pause();}catch{}
    audio.removeAttribute('src');audio.load();
    if(state.audioUrl){URL.revokeObjectURL(state.audioUrl);state.audioUrl=null;}
  }
  function updateAudio(){
    resetAudio();
    const music=state.files.mp3;
    if(music){state.audioUrl=URL.createObjectURL(music);$('music-preview').src=state.audioUrl;}
  }
  function inspectAnimation(array){
    // Exact Uhhhhhh .anim binary structure. Validate without decoding poses to objects.
    if(!(array instanceof ArrayBuffer)||array.byteLength<6||array.byteLength>MAX.anim)throw Error('Invalid or oversized .anim file.');
    const view=new DataView(array);let offset=0;
    const need=n=>{if(offset+n>view.byteLength)throw Error('Truncated .anim data.');};
    const u16=()=>{need(2);const n=view.getUint16(offset,true);offset+=2;return n;};
    const u32=()=>{need(4);const n=view.getUint32(offset,true);offset+=4;return n;};
    const f32=()=>{need(4);const n=view.getFloat32(offset,true);offset+=4;if(!Number.isFinite(n)||Math.abs(n)>1000000)throw Error('Invalid animation float.');return n;};
    const str=()=>{const len=u16();if(len>512)throw Error('Invalid .anim string length.');need(len);const v=dec.decode(new Uint8Array(array,offset,len));offset+=len;return v;};
    const name=str(),count=u32();
    if(count<1||count>1500)throw Error('Unsupported keyframe count in .anim.');
    let duration=0;
    for(let i=0;i<count;i++){
      const time=f32();if(time<0||time>300)throw Error('Animation length must be 0–300 seconds.');
      duration=Math.max(duration,time);
      const poses=u32();if(poses>100)throw Error('Too many poses per keyframe.');
      for(let j=0;j<poses;j++){
        str();f32();str();str();
        for(let k=0;k<12;k++)f32();
      }
    }
    return {name:name||'Unnamed animation',frames:count,duration};
  }
  async function verifyFile(file,key) {
    if(!file || typeof file.name!=='string'||!file.name.toLowerCase().endsWith(EXT[key]))throw Error('Please choose a '+EXT[key]+' file.');
    if(file.size<1||file.size>MAX[key])throw Error(file.name+' must be between 1 byte and '+formatBytes(MAX[key])+'.');
    if(key==='anim')return inspectAnimation(await file.arrayBuffer());
    if(key==='lua'){
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(bytes.includes(0))throw Error('Lua file appears to contain binary data.');
      return {bytes:bytes.length};
    }
    // MP3s can start with ID3 metadata or an MPEG frame header. Some valid
    // MP3 variants start differently; the audio element is the final decoder.
    return {bytes:file.size};
  }
  async function putFile(key,file) {
    if(state.busy)return;
    try{
      const info=await verifyFile(file,key);
      const projected=totalBytes()-(state.files[key]?.size||0)+file.size;
      if(projected>MAX_TOTAL)throw Error('Total pack size exceeds '+formatBytes(MAX_TOTAL)+'.');
      state.files[key]=file;
      if(key==='anim'){
        state.animationInfo=info;
        if(!trim($('pack-title').value)||$('pack-title').dataset.autofilled==='yes'){
          $('pack-title').value=info.name||titleOfFile(file.name);
          $('pack-title').dataset.autofilled='yes';
        }
      }
      if(key==='mp3')updateAudio();
      status('Added '+file.name+' ('+formatBytes(file.size)+'). '+(allPresent()?'All three files ready.':'Add the remaining files.'));
      updateView();
      toast(key.toUpperCase()+' file added.');
    }catch(e){toast(e.message||'Unable to read file.',true);status('File rejected: '+(e.message||'Invalid file'));}
  }
  async function putMany(files){
    const recognized={};
    for(const f of Array.from(files||[])){
      const key=Object.keys(EXT).find(k=>f.name.toLowerCase().endsWith(EXT[k]));
      if(key)recognized[key]=f;
      else toast('Unsupported file: '+f.name,true);
    }
    for(const key of Object.keys(EXT))if(recognized[key])await putFile(key,recognized[key]);
  }
  function clearPack(){
    resetAudio();state.files={anim:null,mp3:null,lua:null};state.id=null;state.animationInfo=null;
    $('pack-title').value='';$('pack-title').dataset.autofilled='no';
    $('pack-author').value='';$('pack-notes').value='';
    updateView();status('Select your .anim, .mp3, and .lua files.');
  }

  // Minimal ZIP writer, no compression. Every entry is stored with correct
  // local header, CRC-32, central directory and UTF-8 name flag.
  const crcTable=(()=>{
    const table=new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let j=0;j<8;j++)c=(c&1)?0xEDB88320^(c>>>1):(c>>>1);
      table[i]=c>>>0;
    }
    return table;
  })();
  function crc32(bytes){
    let c=0xFFFFFFFF;
    for(let i=0;i<bytes.length;i++)c=(c>>>8)^crcTable[(c^bytes[i])&255];
    return (c^0xFFFFFFFF)>>>0;
  }
  function writeZip(entries){
    let offset=0;const locals=[],central=[],encoder=new TextEncoder();
    for(const entry of entries){
      const data=entry.bytes instanceof Uint8Array?entry.bytes:new Uint8Array(entry.bytes);
      const filename=encoder.encode(safeZipFileName(entry.name));
      if(filename.byteLength>65535)throw Error('File name too long for ZIP.');
      const checksum=crc32(data),length=data.byteLength;
      const local=new Uint8Array(30+filename.length+length);
      const l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);
      l.setUint16(6,0x0800,true);l.setUint16(8,0,true); // UTF-8, stored
      l.setUint32(14,checksum,true);
      l.setUint32(18,length,true);l.setUint32(22,length,true);
      l.setUint16(26,filename.length,true);
      local.set(filename,30);local.set(data,30+filename.length);
      locals.push(local);

      const center=new Uint8Array(46+filename.length);
      const v=new DataView(center.buffer);
      v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);
      v.setUint16(8,0x0800,true);v.setUint16(10,0,true);
      v.setUint32(16,checksum,true);v.setUint32(20,length,true);v.setUint32(24,length,true);
      v.setUint16(28,filename.length,true);v.setUint32(42,offset,true);
      center.set(filename,46);central.push(center);
      offset+=local.length;
    }
    const centralStart=offset;
    for(const c of central)offset+=c.length;
    const end=new Uint8Array(22),v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);
    v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);
    v.setUint32(12,offset-centralStart,true);v.setUint32(16,centralStart,true);
    return new Blob([...locals,...central,end],{type:'application/zip'});
  }
  async function packBlob(){
    if(!allPresent())throw Error('An .anim, .mp3 and .lua are all required.');
    const files=Object.keys(EXT).map(key=>state.files[key]);
    const bytes=await Promise.all(files.map(f=>f.arrayBuffer()));
    return writeZip(files.map((f,i)=>({name:f.name,bytes:new Uint8Array(bytes[i])})));
  }
  function download(blob,filename){
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  async function downloadPack(){
    if(!allPresent()||state.busy)return;
    state.busy=true;updateView();
    try{
      const zip=await packBlob();
      download(zip,zipName(details().title));
      toast('ZIP downloaded with .anim + .mp3 + .lua.');
      status('Downloaded '+zipName(details().title)+' · '+formatBytes(zip.size));
    }catch(e){toast(e.message||'Could not create ZIP.',true);}
    finally{state.busy=false;updateView();}
  }

  function openDb(){
    return new Promise(resolve=>{
      if(!('indexedDB' in window)){resolve(null);return;}
      let req;
      try{req=indexedDB.open(STORE,1);}catch{resolve(null);return;}
      req.onupgradeneeded=()=>{
        if(!req.result.objectStoreNames.contains('packs'))req.result.createObjectStore('packs',{keyPath:'id'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>resolve(null);
      req.onblocked=()=>resolve(null);
    });
  }
  function objectStore(mode){
    if(!state.db)return null;
    try{return state.db.transaction('packs',mode).objectStore('packs');}
    catch{return null;}
  }
  function requestToPromise(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Local storage operation failed.'));
    });
  }
  async function reloadLibrary(){
    const store=objectStore('readonly');
    if(!store){state.saved=[];renderLibrary();return;}
    try{state.saved=(await requestToPromise(store.getAll())).sort((a,b)=>b.savedAt-a.savedAt);}
    catch(e){state.saved=[];toast('Browser storage could not be read.',true);}
    renderLibrary();
  }
  async function savePack(){
    if(!allPresent()||state.busy)return;
    if(!state.db){toast('Browser storage unavailable. Download the ZIP to keep it.',true);return;}
    state.busy=true;updateView();
    try{
      const info=details();
      const record={
        id:state.id||generatedId(),title:info.title,author:info.author,notes:info.notes,
        savedAt:Date.now(),
        files:Object.fromEntries(Object.entries(state.files).map(([key,file])=>[key,{name:file.name,data:file}]))
      };
      await requestToPromise(objectStore('readwrite').put(record));
      state.id=record.id;await reloadLibrary();
      toast('Saved to this browser.');status('Saved '+record.title+' locally.');
    }catch(e){toast('Could not save pack: '+(e.message||'Storage error'),true);}
    finally{state.busy=false;updateView();}
  }
  async function loadSaved(record){
    if(state.busy)return;
    try{
      const files={};
      for(const key of Object.keys(EXT)){
        const item=record.files&&record.files[key];
        if(!item||!item.data)throw Error('A required file is missing from this saved pack.');
        files[key]=new File([item.data],item.name||('animation'+EXT[key]),{type:item.data.type||''});
      }
      const validation=await verifyFile(files.anim,'anim');
      await verifyFile(files.mp3,'mp3');await verifyFile(files.lua,'lua');
      resetAudio();
      state.files=files;state.animationInfo=validation;state.id=record.id;
      $('pack-title').value=record.title||validation.name;
      $('pack-title').dataset.autofilled='no';
      $('pack-author').value=record.author||'';
      $('pack-notes').value=record.notes||'';
      updateAudio();updateView();
      status('Loaded '+record.title+' from your browser library.');
      $('uploader').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){toast('Could not load saved pack: '+(e.message||'Invalid files'),true);}
  }
  async function deleteSaved(record){
    if(!window.confirm('Delete "'+record.title+'" from this browser?'))return;
    try{
      await requestToPromise(objectStore('readwrite').delete(record.id));
      if(state.id===record.id)state.id=null;
      await reloadLibrary();toast('Local pack deleted.');
    }catch(e){toast('Could not delete pack.',true);}
  }
  function renderLibrary(){
    const host=$('saved-packs');host.replaceChildren();
    $('library-count').textContent=state.saved.length+' PACKS';
    if(!state.saved.length){
      const blank=document.createElement('div');blank.className='empty-library';
      blank.textContent='Nothing saved yet. Make a pack above, then select “Save to my browser library.”';
      host.appendChild(blank);return;
    }
    for(const pack of state.saved){
      const card=document.createElement('article');card.className='saved-card';
      const head=document.createElement('div');head.className='saved-heading';
      const icon=document.createElement('span');icon.className='saved-icon';icon.textContent='◈';
      const labels=document.createElement('div');
      const title=document.createElement('strong');title.textContent=pack.title||'Untitled pack';
      const subtitle=document.createElement('small');subtitle.textContent=(pack.author?'by '+pack.author+' · ':'')+'3 files · '+new Date(pack.savedAt).toLocaleDateString();
      labels.append(title,subtitle);head.append(icon,labels);
      const notes=document.createElement('p');notes.textContent=pack.notes||'Animation, music, and Lua module bundled in one pack.';
      const actions=document.createElement('div');actions.className='saved-actions';
      const load=document.createElement('button');load.textContent='Open';load.addEventListener('click',()=>loadSaved(pack));
      const dl=document.createElement('button');dl.textContent='Download';dl.addEventListener('click',async()=>{
        try{
          const entries=await Promise.all(Object.keys(EXT).map(async key=>{
            const f=pack.files[key];
            if(!f)throw Error('Missing file: '+key);
            return {name:f.name,bytes:new Uint8Array(await f.data.arrayBuffer())};
          }));
          const zip=writeZip(entries);download(zip,zipName(pack.title));toast('Pack downloaded.');
        }catch(e){toast(e.message||'Cannot download pack.',true);}
      });
      const del=document.createElement('button');del.textContent='✕';del.title='Delete local saved pack';
      del.className='danger';del.setAttribute('aria-label','Delete '+pack.title);
      del.addEventListener('click',()=>deleteSaved(pack));
      actions.append(load,dl,del);card.append(head,notes,actions);host.appendChild(card);
    }
  }

  function attach(){
    for(const key of Object.keys(EXT)){
      const input=$(key+'-input');
      $('pick-'+key).addEventListener('click',()=>input.click());
      input.addEventListener('change',async()=>{
        const file=input.files?.[0];if(file)await putFile(key,file);
        input.value='';
      });
    }
    const area=$('drop-zone'),all=$('all-input');
    function chooseAll(){all.click();}
    area.addEventListener('click',chooseAll);
    area.addEventListener('keydown',e=>{
      if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseAll();}
    });
    all.addEventListener('change',async()=>{await putMany(all.files);all.value='';});
    ['dragenter','dragover'].forEach(type=>area.addEventListener(type,e=>{e.preventDefault();area.classList.add('dragging');}));
    ['dragleave','drop'].forEach(type=>area.addEventListener(type,e=>{e.preventDefault();area.classList.remove('dragging');}));
    area.addEventListener('drop',e=>putMany(e.dataTransfer.files));
    window.addEventListener('dragover',e=>e.preventDefault());
    window.addEventListener('drop',e=>{if(e.target.closest?.('#drop-zone'))return;e.preventDefault();if(e.dataTransfer?.files?.length)putMany(e.dataTransfer.files);});
    $('reset-pack').addEventListener('click',()=>{clearPack();toast('Pack cleared.');});
    $('download-pack').addEventListener('click',downloadPack);
    $('save-pack').addEventListener('click',savePack);
    $('pack-title').addEventListener('input',()=>{$('pack-title').dataset.autofilled='no';updateView();});
    window.addEventListener('beforeunload',resetAudio);
  }
  async function initialize(){
    attach();updateView();
    try{state.db=await openDb();await reloadLibrary();}
    catch(e){state.db=null;toast('Local saving is unavailable; ZIP downloads still work.',true);}
    updateView();
  }
  initialize();
})();