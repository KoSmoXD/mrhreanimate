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
