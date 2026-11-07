/* Shared dance / moveset PNG and Roblox accessory model editor. */
(()=>{'use strict';
const V=window.MrhVisualSettings,editors={};
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
const pretty=n=>String(n).padStart(2,'0');
function mount(maker,formId,submitId){
 const form=document.getElementById(formId),root=el('section',null,'maker-visuals'),list=el('div'),error=el('p',null,'visual-error');
 let serial=0;const rows=[];
 root.append(el('h3','Effects & accessories'),el('p','Upload PNG images for effects and Roblox .rbxm / .rbxmx models for accessories.','make-note'));
 const actions=el('div',null,'visual-actions');root.append(actions,list,error,el('p','PNG images are bundled with the ZIP for local particle effects. Accessory models are included in the ZIP; equip the model in Roblox first for named accessory behavior to work. Timing uses seconds within each animation loop.','make-note'));
 form.insertBefore(root,document.getElementById(submitId));
 function field(parent,label,key,options={}){
  const wrap=el('label',label),input=options.values?document.createElement('select'):document.createElement('input');
  input.dataset.key=key;input.id=maker+'-visual-'+serial+'-'+key;wrap.htmlFor=input.id;
  if(options.values)for(const v of options.values)input.add(new Option(Array.isArray(v)?v[1]:v,Array.isArray(v)?v[0]:v));
  else{input.type=options.type||'number';if(input.type==='number'){input.step='.1';if(options.min!==undefined)input.min=options.min;if(options.max!==undefined)input.max=options.max}if(options.type==='text'){input.maxLength=80;input.placeholder='Accessory name in Roblox'}}
  input.value=options.value??(options.values?(Array.isArray(options.values[0])?options.values[0][0]:options.values[0]):0);
  wrap.append(input);parent.append(wrap);return input;
 }
 function read(){
  const settings=V.empty(),counts={effects:0,accessories:0};
  for(const row of rows){
   const out={};for(const n of row.node.querySelectorAll('[data-key]'))out[n.dataset.key]=n.type==='number'?(n.value===''?null:Number(n.value)):n.value;
   const file=row.upload.files?.[0],index=++counts[row.kind],filename=file?.name||'';
   if(row.kind==='effects'){
    if(!file||!/.png$/i.test(filename)||file.type&&file.type!=='image/png'||file.size<24||file.size>2*1048576)throw Error('Choose a PNG image under 2 MB for every effect.');
    out.type='png';out.image='MRH_Effect_'+pretty(index)+'.png';out.color='#ffffff';
   }else{
    if(!file||!/\.(rbxm|rbxmx)$/i.test(filename)||file.size<32||file.size>4*1048576)throw Error('Choose a .rbxm / .rbxmx model under 4 MB for every accessory.');
    out.model='MRH_Accessory_'+pretty(index)+filename.match(/\.(rbxm|rbxmx)$/i)[0].toLowerCase();
    out.offset=['x','y','z'].map(k=>out['offset'+k]);out.rotation=['x','y','z'].map(k=>out['rotation'+k]);
    for(const k of ['x','y','z']){delete out['offset'+k];delete out['rotation'+k]}
   }
   settings[row.kind].push(out);
  }
  return V.validate(settings);
 }
 function changed(){
  for(const row of rows){
   const val=k=>row.node.querySelector('[data-key="'+k+'"]')?.value||'';
   const file=row.upload.files?.[0];
   row.node.querySelector('summary').textContent=row.kind==='effects'?'PNG · '+(file?.name||'Select image')+' · '+val('target'):(val('name')||file?.name||'Select model')+' · '+val('behavior');
  }
  try{const settings=read();error.textContent='';window.dispatchEvent(new CustomEvent('mrh-visual-settings',{detail:{maker,settings}}))}
  catch(e){error.textContent=e.message}
 }
 function add(kind){
  if(rows.filter(r=>r.kind===kind).length>=(kind==='effects'?12:8)){error.textContent='Upload limit reached.';return}
  serial++;
  const details=el('details',null,'visual-rule');details.open=true;
  const summary=el('summary',(kind==='effects'?'PNG effect ':'Accessory model ')+serial),grid=el('div',null,'visual-grid');details.append(summary,grid);
  const fileLabel=el('label',kind==='effects'?'PNG effect image':'Roblox accessory model (.rbxm / .rbxmx)');
  const upload=document.createElement('input');upload.type='file';upload.accept=kind==='effects'?'.png,image/png':'.rbxm,.rbxmx';upload.required=true;
  fileLabel.append(upload);grid.append(fileLabel);
  const row={kind,node:details,upload,previewUrl:null};
  let modelName;
  if(kind==='effects'){
   const preview=el('img');preview.alt='Effect PNG preview';preview.hidden=true;preview.style.cssText='width:72px;height:72px;object-fit:contain;border-radius:8px;';
   grid.append(preview);
   upload.addEventListener('change',()=>{
    if(row.previewUrl)URL.revokeObjectURL(row.previewUrl);row.previewUrl=null;preview.hidden=true;
    const file=upload.files?.[0];if(file&&/\.png$/i.test(file.name)){row.previewUrl=URL.createObjectURL(file);preview.src=row.previewUrl;preview.hidden=false}
   });
   field(grid,'Attach effect to','target',{values:[...V.PARTS,['accessory','Named accessory']]});
   field(grid,'Accessory name (if attached to accessory)','name',{type:'text',value:''});
   field(grid,'Effect size','scale',{value:1,min:.1,max:10});
  }else{
   modelName=field(grid,'Accessory name','name',{type:'text',value:''});
   field(grid,'Behavior','behavior',{values:V.BEHAVIORS,value:'follow'});
   field(grid,'Follow body part','part',{values:V.PARTS,value:'Head'});
   for(const key of ['offset','rotation'])for(const axis of ['x','y','z'])
    field(grid,(key==='offset'?'Offset ':'Rotation ° ')+axis.toUpperCase(),key+axis,{value:0,min:key==='offset'?-10:-360,max:key==='offset'?10:360});
   field(grid,'Speed (turns / sec)','speed',{value:1,min:0,max:5});
   field(grid,'Orbit radius / bob height','distance',{value:1,min:0,max:10});
   upload.addEventListener('change',()=>{if(!modelName.value.trim()&&upload.files?.[0])modelName.value=upload.files[0].name.replace(/\.(rbxm|rbxmx)$/i,'').slice(0,80);changed()});
  }
  const stateValues=maker==='dance'?['all','dance']:V.STATES.filter(s=>s!=='dance');
  field(grid,'Active state','state',{values:stateValues});
  field(grid,'Start (sec)','start',{value:0,min:0,max:300});
  field(grid,'End (blank = clip end)','end',{value:'',min:0,max:300});
  const remove=el('button','Remove','action');remove.type='button';
  remove.onclick=()=>{if(row.previewUrl)URL.revokeObjectURL(row.previewUrl);rows.splice(rows.indexOf(row),1);details.remove();changed()};
  details.append(remove);rows.push(row);list.append(details);changed();
 }
 for(const [kind,label]of[['effects','+ Add PNG effect'],['accessories','+ Add accessory model']]){
  const button=el('button',label,'action');button.type='button';button.onclick=()=>add(kind);actions.append(button);
 }
 root.addEventListener('input',changed);root.addEventListener('change',changed);
 editors[maker]={get:read,appendFiles:data=>{read();for(const row of rows)data.append(row.kind,row.upload.files[0],row.upload.files[0].name)}};
}
mount('dance','make-form','maker-convert');mount('moveset','moveset-form','moveset-create');
window.MrhMakerVisuals={get:maker=>editors[maker].get(),appendFiles:(maker,data)=>editors[maker].appendFiles(data)};
})();