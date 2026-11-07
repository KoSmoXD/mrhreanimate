'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('moveset batch importer assigns named tracks, fills unknown names and supplies default name',()=>{
 const els={};const roles=['idle','walk','run','jump','fall','climb','sit'];
 const el=id=>els[id]||(els[id]={value:'',files:[],listeners:{},textContent:'',classList:{toggle(){}},closest(){return this},addEventListener(t,f){this.listeners[t]=f},dispatchEvent(e){this.listeners[e.type]?.(e)}});
 const context={document:{getElementById:el},window:{},Event:class{constructor(type){this.type=type}},DataTransfer:class{constructor(){this.files=[];this.items={add:f=>this.files.push(f)}}}};
 for(const r of roles)el('moveset-'+r);
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../docs/moveset.js'),'utf8'),context);
 const idle={name:'my_idle.anim',size:100},walk={name:'my_walk.anim',size:100};
 el('moveset-files').files=[walk,idle];el('moveset-files').dispatchEvent({type:'change'});
 assert.equal(el('moveset-idle').files[0],idle);assert.equal(el('moveset-walk').files[0],walk);assert.equal(el('moveset-name').value,'my walk');assert.match(el('moveset-completeness').textContent,/2 \/ 2/);
 el('moveset-files').files=[{name:'extra.anim',size:100}];el('moveset-files').dispatchEvent({type:'change'});assert.equal(el('moveset-run').files[0].name,'extra.anim');
 el('moveset-files').files=[idle,idle];el('moveset-files').dispatchEvent({type:'change'});assert.match(el('moveset-error').textContent,/Multiple files match idle/);
});


test('Plan and owner key generator belong to workspace navigation, never the account header',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../docs/index.html'),'utf8');
 const header=html.match(/<header class="site-header">([\s\S]*?)<\/header>/)?.[1];
 const tabs=html.match(/<nav class="site-tabs"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(header&&tabs,'page must contain header and workspace tabs');
 assert.doesNotMatch(header,/id="tab-plan"|id="tab-keygen"/,'large desktop sidebar buttons must not wrap account controls');
 assert.match(tabs,/id="tab-plan"/,'Plan must be visible in workspace sidebar');
 assert.match(tabs,/id="tab-keygen"[^>]*hidden/,'owner key generator stays hidden by default');
 assert.equal((html.match(/id="tab-plan"/g)||[]).length,1,'Plan tab must be unique');
 assert.match(header,/id="upload-trigger"/);
 assert.match(header,/id="account-trigger"/);
 assert.match(header,/id="logout-trigger"/);
});
test('account controls remain single row on desktop and can wrap without clipping on mobile',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../../docs/claude-ui.css'),'utf8');
 const correction=css.slice(css.indexOf('November 2026 header/navigation correction'));
 assert.match(correction,/justify-content:flex-end/,'desktop header aligns account controls to the right');
 assert.match(correction,/flex-flow:row nowrap/,'desktop account buttons must not wrap under the header');
 assert.match(correction,/height:auto/,'small screens expand header rather than clip buttons');
 assert.match(correction,/min-height:76px/,'mobile header keeps usable minimum height');
});
