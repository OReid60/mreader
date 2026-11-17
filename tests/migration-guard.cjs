const{chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{const p=await browser.newPage();await p.addInitScript(()=>{
 window.guardFixture={apk:{installed:[],repositories:[]},calls:[],fail:false};const settings={theme:'dark',language:'en',fit:'width',direction:'ltr',startPage:'Library'};
 window.__TAURI__={core:{invoke:async(name,args)=>{const f=window.guardFixture;
  if(name==='snapshot')return {books:[],progress:[],categories:['Default'],settings,dataDir:'fixture'};
  if(name==='apk_state')return structuredClone(f.apk);if(name==='cloud_status')return {configured:false,signedIn:false};if(name==='download_queue'||name==='extension_list')return [];if(name==='verification_plan')return {enabled:false};
  if(name==='apk_install'){f.calls.push('install:'+args.package);if(f.fail)throw Error('Signature mismatch');const ext=f.apk.repositories.find(r=>r.url===args.repository).catalog.extensions.find(e=>e.package===args.package);f.apk.installed.push({extension:ext});return structuredClone(f.apk);}
  if(name==='cover_data'){if(!f.apk.installed.length)throw Error('Extension missing');return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0)).buffer;}
  if(name==='refresh_restored_book'){f.calls.push('refresh:'+args.bookId);return {book:state.books.find(b=>b.id===args.bookId),warnings:[]};}throw Error(name);
 }},event:{listen:async()=>{}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>{}})}};
 });await p.goto(pathToFileURL(path.resolve('index.html')).href);await p.waitForFunction(()=>state.dataDir==='fixture');
 async function run(mode){return p.evaluate(async mode=>{
  const ext=(pkg,ids)=>({package:pkg,name:pkg,version:'1',versionCode:1,sources:ids.map(id=>({id,name:id,language:'en'}))});const a=ext('fixture.a',['1','2']),other=ext('fixture.b',['1']);
  guardFixture.apk={installed:mode==='installed'?[{extension:a}]:[],repositories:mode==='missing'?[]:[{url:'https://fixture.invalid/index',catalog:{extensions:mode==='ambiguous'?[a,other]:[a]}}]};guardFixture.calls=[];guardFixture.fail=mode==='signature';
  state.books=(mode==='ambiguous'?['1']:['1','2']).map(id=>({id:'b'+id,title:'Manga '+id,source:'apk:'+id,remoteId:id,chapters:[],tags:[]}));state.progress=[{bookId:'b1',chapterId:'c',page:7,completed:false,updated:123}];state.page='Settings';featureState.settingsTab='storage';featureState.migrationResult=null;
  const before=JSON.stringify(state.progress);await refreshRestoredBooks(['b1','b2']);return {calls:guardFixture.calls,errors:featureState.restoreRefresh.errors,done:featureState.restoreRefresh.done,unchanged:before===JSON.stringify(state.progress)};
 },mode);}
 let r=await run('install');assert.deepEqual(r.calls,['install:fixture.a','refresh:b1','refresh:b2']);assert.equal(r.errors.length,0);assert(r.unchanged);
 r=await run('installed');assert(!r.calls.some(c=>c.startsWith('install')));assert.equal(r.done,2);
 r=await run('missing');assert.deepEqual(r.calls,[]);assert.equal(r.errors.length,2);assert(r.unchanged);
 r=await run('signature');assert.deepEqual(r.calls,['install:fixture.a']);assert.equal(r.errors.length,2);assert(r.unchanged);
 r=await run('ambiguous');assert(r.errors.some(e=>e.error.includes('Multiple matching')));assert(r.unchanged);
 await run('install');
 await p.evaluate(()=>{guardFixture.apk.installed=[];featureState.apk=structuredClone(guardFixture.apk);guardFixture.calls=[];sourceRepair.attempted.clear();sourceRepair.errors.clear();coverCache.clear();coverFailed.clear();state.detail=state.books[0];window.autoProgress=JSON.stringify(state.progress);renderDetails();});
 await p.waitForFunction(()=>featureState.apk.installed.length===1&&!sourceRepair.running);
 assert.equal(await p.locator('.manga-source-info h3').innerText(),'Source / extension');
 assert((await p.locator('.manga-source-info').innerText()).includes('fixture.a'));
 assert((await p.locator('.manga-source-info').innerText()).includes('Available'));
 assert.deepEqual(await p.evaluate(()=>guardFixture.calls),['install:fixture.a']);
 assert(await p.evaluate(()=>autoProgress===JSON.stringify(state.progress)));
 await p.evaluate(()=>{closeDetail();featureState.apk={repositories:[],installed:[]};state.books[0].tags=['mreader:source-name:Remembered Mihon source'];sourceRepair.errors.clear();sourceRepair.attempted.add('apk:1');state.detail=state.books[0];renderDetails();});
 assert((await p.locator('.manga-source-info').innerText()).includes('Remembered Mihon source'));
 assert((await p.locator('.manga-source-info').innerText()).includes('needs its source extension'));
 console.log('PASS migration guard: install before refresh, shared-package deduplication, already installed, missing repository, ambiguous source, signature failure and unchanged progress');
 }finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
