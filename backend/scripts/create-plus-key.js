'use strict';
// Run manually on the server only after an explicit request from Mr H.
const crypto=require('node:crypto'),path=require('node:path'),Database=require('better-sqlite3');
function createKey(db,{hours,durationMs,lifetime=false}){
 // Duration is stored in integer milliseconds, allowing one-second subscriptions.
 // Keep legacy --hours callers working without losing existing keys.
 const ms=durationMs===undefined?(Number.isFinite(hours)?hours*3600000:undefined):durationMs;
 if(!lifetime&&(!Number.isSafeInteger(ms)||ms<1000||ms>3650*86400000))
  throw Error('Specify a duration of 1 second to 3650 days, or --lifetime.');

 const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let text='';
 for(let i=0;i<15;i++)text+=alphabet[crypto.randomInt(alphabet.length)];
 const key='PLUS-'+text.match(/.{5}/g).join('-');
 db.prepare('INSERT INTO pro_keys(key_hash,duration_ms,created_at) VALUES(?,?,?)').run(crypto.createHash('sha256').update(key).digest('hex'),lifetime?null:ms,Date.now());
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
