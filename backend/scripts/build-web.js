'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Obfuscator=require('javascript-obfuscator');
const source=path.resolve(__dirname,'../../docs'),output=path.resolve(__dirname,'../../public');
// Only browser assets are published. Documentation, maps and development files stay out.
const allowed=new Set(['.html','.css','.js','.svg','.glb','.png','.jpg','.jpeg','.webp','.woff','.woff2']);
function build(){
 fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});let scripts=0;
 for(const file of fs.readdirSync(source).sort()){
  const ext=path.extname(file);if(!allowed.has(ext)||!fs.statSync(path.join(source,file)).isFile())continue;
  const input=path.join(source,file),destination=path.join(output,file);
  if(ext!=='.js'){fs.copyFileSync(input,destination);continue;}
  const prefix='mrh'+crypto.createHash('sha256').update(file).digest('hex').slice(0,8)+'_';
  const result=Obfuscator.obfuscate(fs.readFileSync(input,'utf8'),{
   target:'browser-no-eval',compact:true,seed:20261106,identifiersPrefix:prefix,
   identifierNamesGenerator:'hexadecimal',renameGlobals:false,renameProperties:false,
   stringArray:true,stringArrayThreshold:0.6,stringArrayEncoding:[],
   controlFlowFlattening:false,deadCodeInjection:false,selfDefending:false,
   debugProtection:false,disableConsoleOutput:false,sourceMap:false
  });
  fs.writeFileSync(destination,result.getObfuscatedCode());scripts++;
 }
 console.log('Production web build: '+scripts+' obfuscated scripts; no source maps or development documents.');
 return output;
}
if(require.main===module)build();
module.exports={build};
