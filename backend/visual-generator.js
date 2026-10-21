'use strict';
const fs=require('node:fs'),path=require('node:path'),V=require('../docs/visual-settings');
const runtime=fs.readFileSync(path.join(__dirname,'visual-runtime.lua'),'utf8');
function makeVisualRuntime(input){const settings=V.validate(input);if(!settings.effects.length&&!settings.accessories.length)return '';
 return 'local visuals = (function(settings)\n'+runtime+'\nend)(game:GetService("HttpService"):JSONDecode('+JSON.stringify(JSON.stringify(settings))+'))';
}
module.exports={makeVisualRuntime,validateVisualSettings:V.validate};
