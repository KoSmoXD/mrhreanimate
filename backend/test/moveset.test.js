'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {makeMoveset}=require('../moveset-generator');

test('Uhhhhhh MOVESET generator produces a smooth state-machine module',()=>{
  const result=makeMoveset({name:'Example Move',roles:{idle:true,walk:true,run:true,jump:true},music:true,fade:0.25,runSpeed:18});
  assert.match(result.source,/m\.ModuleType = "MOVESET"/);
  assert.match(result.source,/AnimLib\.Animator\.new/);
  assert.match(result.source,/active\.weight = alpha/);
  assert.match(result.source,/SetOverrideMovesetMusic/);
  assert.match(result.source,/GetAttribute\("IsDancing"\)/);
  assert.equal(result.assets.walk,'MRH_Example_Move_walk.anim');
  assert.equal(result.assets.music,'MRH_Example_Move_music.mp3');
  assert.equal(result.filename,'MRH_Example_Move_Moveset.lua');
});
test('Moveset generator validates input and optional states',()=>{
 assert.throws(()=>makeMoveset({name:'Bad',roles:{idle:true},fade:.2,runSpeed:16}),/Idle and Walk/);
 assert.throws(()=>makeMoveset({name:'Good',roles:{idle:true,walk:true},fade:0,runSpeed:16}),/Transition/);
 const made=makeMoveset({name:'No Music',roles:{idle:true,walk:true},fade:.2,runSpeed:16});
 assert.equal(made.assets.music,undefined);
 assert.ok(!made.source.includes('SetOverrideMovesetMusic('));
 assert.ok(made.source.includes('return animators.walk and "walk" or "idle"'));
});
