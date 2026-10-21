'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
test('owner bootstrap is disabled by default even with a valid configured setup key',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mrh-owner-guard-')),port=45000+Math.floor(Math.random()*5000),secret='fixture-only-bootstrap-key-0123456789-ABCDEFGHIJKLMN';
 const env={...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'development',TRUST_PROXY:'false',OWNER_SETUP_KEY:secret};delete env.OWNER_SETUP_ENABLED;
 const child=spawn(process.execPath,[path.resolve(__dirname,'../server.js')],{env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const base='http://127.0.0.1:'+port;
 try{let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('Server failed: '+logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'backend should start');
 const result=await fetch(base+'/api/owner/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({setupKey:secret,password:'FixturePassword123'})});assert.equal(result.status,404);assert.deepEqual(await result.json(),{error:'Not found.'});
 const page=await(await fetch(base+'/')).text(),script=await(await fetch(base+'/app.js')).text();for(const text of [page,script]){assert.ok(!text.includes(secret));assert.ok(!text.includes('owner-setup-key'));assert.ok(!text.includes('/owner/claim'));}
 const unknown=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'UnknownFixture',password:'FixturePassword123'})});assert.equal(unknown.status,401);assert.deepEqual(await unknown.json(),{error:'Invalid username or password.'});
 }finally{child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(resolve,3000);child.once('exit',()=>{clearTimeout(timer);resolve()})});fs.rmSync(dir,{force:true,recursive:true});}
});
