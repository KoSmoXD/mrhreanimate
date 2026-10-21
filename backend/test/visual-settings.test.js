'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),V=require('../../docs/visual-settings'),{makeVisualRuntime}=require('../visual-generator'),{makeMoveset}=require('../moveset-generator');
test('visual settings reject malformed input, duplicate accessory states and out-of-range values',()=>{
 assert.deepEqual(V.validate(),V.empty());assert.throws(()=>V.validate('{'),/JSON/);
 for(const bad of [{effects:Array(13).fill({})},{accessories:[{name:'Hat',speed:Infinity}]},{accessories:[{name:'Hat',offset:[0,11,0]}]},{effects:[{type:'script'}]},{effects:[{color:'red'}]},{effects:[{start:2,end:1}]},{accessories:[{name:'Hat'},{name:'Hat'}]}])assert.throws(()=>V.validate({...V.empty(),...bad}));
 const normalized=V.validate({...V.empty(),accessories:[{name:'Hat "炎" \\ test',extra:'ignored'}]});assert.equal(normalized.accessories[0].name,'Hat "炎" \\ test');assert.equal(normalized.accessories[0].extra,undefined);
});
test('state-specific accessory rules override global rules only during their time window',()=>{
 const settings=V.validate({...V.empty(),accessories:[{name:'Hat',behavior:'bob'},{name:'Hat',behavior:'hidden',state:'walk',start:1,end:2}]});
 assert.equal(V.chosen(settings,'walk',.9)[0].behavior,'bob');assert.equal(V.chosen(settings,'walk',1)[0].behavior,'hidden');assert.equal(V.chosen(settings,'walk',2)[0].behavior,'bob');assert.equal(V.chosen(settings,'idle',1)[0].behavior,'bob');assert.equal(V.chosen(settings,null,1).length,0);
 const orbit=V.validate({...V.empty(),accessories:[{name:'Hat',behavior:'orbit',speed:1,distance:2}]}).accessories[0];const p=V.transform(orbit,.25).position;assert.ok(Math.abs(p[0])<1e-8);assert.equal(p[2],2);
});
test('visual runtime is opt-in and generated movesets suspend it during dances and clean up',()=>{
 assert.equal(makeVisualRuntime(), '');const base={name:'Visual Test',roles:{idle:true,walk:true}};assert.ok(!makeMoveset(base).source.includes('visuals.'));
 const source=makeMoveset({...base,visuals:{...V.empty(),effects:[{type:'trail'}],accessories:[{name:'Test Hat',behavior:'orbit'}]}}).source;
 assert.match(source,/visuals.Init\(figure\)/);assert.match(source,/visuals.Step\(figure, nil/);assert.match(source,/active.track.Time, active.looped/);assert.match(source,/visuals.Destroy\(\)/);
});

// Optional official Luau CLI: exercises behavior with mock Roblox objects, without an executor.
test('visual runtime restores original accessories and preserves unrelated overrides',{skip:!process.env.LUAU_BIN},()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mrh-visual-luau-'));
 try{const fixture=fs.readFileSync(path.join(__dirname,'visual-runtime.fixture.luau'),'utf8'),runtime=fs.readFileSync(path.join(__dirname,'../visual-runtime.lua'),'utf8'),file=path.join(dir,'check.luau');fs.writeFileSync(file,fixture.replace('-- INSERT_VISUAL_RUNTIME_HERE',runtime));const result=spawnSync(process.env.LUAU_BIN,[file],{encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
