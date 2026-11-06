'use strict';
// Run manually on the server only after an explicit request from Mr H.
const crypto=require('node:crypto'),path=require('node:path'),Database=require('better-sqlite3');
function createKey(db,{hours,lifetime=false}){
 if(!lifetime&&(!Number.isFinite(hours)||hours<1||hours>876000))throw Error('Specify --hours between 1 and 876000, or --lifetime.');
 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let text='';
 for(let i=0;i<15;i++)text+=alphabet[crypto.randomInt(alphabet.length)];
 const key='PLUS-'+text.match(/.{5}/g).join('-');
 db.prepare('INSERT INTO pro_keys(key_hash,duration_ms,created_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(key).digest('hex'),lifetime?null:Math.round(hours*3600000),Date.now());
 return key;
}
if(require.main===module){
 let db;
 try{
  const args=process.argv.slice(2),lifetime=args.length===1&&args[0]==='--lifetime';
  if(!lifetime&&!(args.length===2&&args[0]==='--hours'))throw Error('Usage: node scripts/create-plus-key.js --hours 24 | --lifetime');
  const root=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));
  db=new Database(path.join(root,'gallery.sqlite'),{fileMustExist:true});db.pragma('busy_timeout=6000');
  console.log(createKey(db,{lifetime,hours:Number(args[1])}));
 }catch(error){console.error(error.message);process.exitCode=1}finally{db?.close()}
}
module.exports={createKey};
