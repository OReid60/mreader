const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const files=cp.execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(f=>f&&fs.existsSync(f));
for(const file of files){if(fs.statSync(file).size>2000000)continue;const text=fs.readFileSync(file,'utf8');assert(!/https?:\/\/(?:[^\s"'<>]*\.)?keiyoushi\.|https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\/keiyoushi\//i.test(text),'Third-party repository link in '+file);}
assert(!fs.existsSync('extensions/mangadex.mreader.json'),'Do not distribute a working example extension');
for(const file of ['app.js','features.js','src-tauri/src/lib.rs'])assert(!fs.readFileSync(file,'utf8').includes('extension_example'),'Bundled-extension command in '+file);
assert(!/const [A-Z_]+_KEY:/.test(fs.readFileSync('src-tauri/src/apk/mod.rs','utf8')),'Do not pretrust a repository signer');
console.log('PASS distribution policy: no known repository URLs, pretrusted repository key, or bundled example-extension command');
