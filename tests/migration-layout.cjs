const {chromium}=require('playwright'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),path=require('node:path');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});try{for(const width of [1440,393]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const settings={theme:'dark',language:'en',direction:'ltr',fit:'width',komgaUrl:'',komgaUser:'',startPage:'Library'};
  const snapshot=()=>({books:[],settings,progress:[],categories:['Default','nsfw'],dataDir:'fixture'});window.importCalls=0;window.refreshCalls=0;
  window.__TAURI__={core:{invoke:async(name,args)=>{
   if(name==='snapshot')return snapshot();if(name==='download_queue'||name==='extension_list')return [];
   if(name==='apk_state')return {installed:[{extension:{package:'fixture',name:'Fixture',sources:[{id:'1',name:'Fixture',language:'en'}]}}],repositories:[]};if(name==='cloud_status')return {configured:false,signedIn:false};if(name==='verification_plan')return {enabled:false};
   if(name==='migration_preview')return {manga:[{title:'<script>untrusted title</script>',inLibrary:true,sourceId:'1',source:'Fixture',category:'Default',read:3,inProgress:1,unread:6,chapters:10,installed:false,existing:false},{title:'History-only title',inLibrary:false,source:'Fixture',category:'Default',read:0,inProgress:0,unread:0,chapters:0,installed:false,existing:false}],libraryCount:1,chapters:10,read:3,sources:[{id:'123',name:'Fixture',installed:false,packages:[]}],repositories:[{name:'Fixture repository',url:'https://fixture.invalid/index.pb',fingerprint:'a'.repeat(64)}],warnings:['Downloaded pages and extension APKs are not included.']};
   if(name==='migration_import'){if(!args.confirmed)throw Error('Confirmation required');window.importCalls++;return {imported:1,bookIds:['restored'],snapshot:{...snapshot(),books:[{id:'restored',title:'Restored title',source:'apk:1',remoteId:'source-title',cover:'',chapters:[],tags:[]}]}};}if(name==='refresh_restored_book'){window.refreshCalls++;if(window.refreshCalls===1)throw Error('Source temporarily unavailable');return {book:{id:'restored',title:'Restored title',source:'apk:1',remoteId:'source-title',cover:'fresh-cover',tags:[],chapters:[{id:'new-chapter',number:'1',pages:5,downloaded:false}]},warnings:[]};}if(name==='cover_data')return new Uint8Array([]);throw Error('Unexpected '+name);
  }},event:{listen:async()=>{}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>{}})}};
 });
 await page.goto(pathToFileURL(path.resolve('index.html')).href);await page.waitForFunction(()=>state.dataDir==='fixture');
 await page.evaluate(()=>{state.page='Settings';featureState.settingsTab='general';render();});
 assert.equal(await page.getByRole('button',{name:'Categories',exact:true}).count(),0);
 if(width>760){
  const controls=await page.locator('#settings-form .settings-row > select').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {right:b.right,width:b.width}}));
  assert(controls.every(c=>Math.abs(c.right-controls[0].right)<1&&c.width<=281));
  for(const tab of ['General','Account & sync','Sources','Mobile app','Files & backup']){
   await page.getByRole('tab',{name:tab,exact:true}).click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:`test-artifacts/settings-${tab.split(' ')[0]}-${width}.png`,fullPage:true});
  }
 }
 await page.getByRole('tab',{name:'Sources',exact:true}).click();
 assert.equal(await page.locator('details').filter({has:page.locator('summary', {hasText:'Add extension repository'})}).getAttribute('open'),null);
 await page.getByText('Add extension repository',{exact:true}).click();
 assert.equal(await page.locator('[name="fingerprint"]').isVisible(),false);
 await page.locator('#manual-fingerprint').check();assert(await page.locator('[name="fingerprint"]').isVisible());assert(await page.locator('[name="fingerprint"]').isEnabled());
 await page.locator('#manual-fingerprint').uncheck();assert.equal(await page.locator('[name="fingerprint"]').isEnabled(),false);
 await page.getByRole('tab',{name:'Files & backup',exact:true}).click();
 await page.locator('#migration-file').setInputFiles({name:'fixture.tachibk',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
 await page.waitForSelector('[data-action="migration-import"]');assert.equal(await page.evaluate(()=>importCalls),0);
 assert((await page.locator('.migration-titles').innerText()).includes('<script>untrusted title</script>'));assert.equal(await page.locator('.migration-titles script').count(),0);
 assert((await page.locator('.migration-summary').innerText()).includes('3 read'));
 await page.locator('#migration-history').check();assert((await page.locator('[data-action="migration-import"]').innerText()).includes('Import 2 manga'));await page.locator('#migration-history').uncheck();assert((await page.locator('[data-action="migration-import"]').innerText()).includes('Import 1 manga'));
 await page.locator('[data-action="migration-cancel"]').click();assert.equal(await page.evaluate(()=>importCalls),0);
 await page.locator('#migration-file').setInputFiles({name:'fixture.tachibk',mimeType:'application/octet-stream',buffer:Buffer.from([1,2,3])});
 await page.locator('[data-action="migration-import"]').click();await page.waitForFunction(()=>importCalls===1);
 assert.equal(await page.locator('[data-action="migration-import"]').count(),0);
 await page.waitForFunction(()=>featureState.restoreRefresh&&!featureState.restoreRefresh.active);
 assert(await page.getByText('Source refresh needs attention',{exact:true}).isVisible());
 await page.locator('[data-action="restore-refresh-retry"]').click();
 await page.waitForFunction(()=>refreshCalls===2&&!featureState.restoreRefresh.active);
 assert.equal(await page.evaluate(()=>state.books[0].chapters[0].id),'new-chapter');
 assert.equal(await page.evaluate(()=>state.books[0].cover),'fresh-cover');
 assert.equal(await page.evaluate(()=>featureState.restoreRefresh.errors.length),0);

 assert.equal(await page.getByRole('heading',{name:'Migration',exact:true}).count(),1);
 assert(await page.getByText('Migration successful',{exact:true}).isVisible());
 assert.equal(await page.getByText('Action needed: install missing sources',{exact:true}).count(),0);
 await page.screenshot({path:`test-artifacts/settings-migration-${width}.png`,fullPage:true});
 for(const tab of ['Updates','History','Browse','Downloads']){await page.evaluate(tab=>navigate(tab),tab);if(width>760)assert.equal(await page.locator('.compact-heading').count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS migration preview/confirmation/cancel, escaped metadata, Library category shortcut, collapsed repository and manual fingerprint toggle; compact desktop/mobile tabs');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
