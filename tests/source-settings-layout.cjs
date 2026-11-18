const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
try{for(const width of [320,393,768,1440]){
 const mobile=width<=768,page=await browser.newPage({viewport:{width,height:900},...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'}:{})}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const settings={theme:'dark',language:'en',apkLayout:'list',filesLayout:'stacked',...JSON.parse(sessionStorage.getItem('settings-fixture')||'{}')};
  const extensions=[1,2].map(id=>({name:'Source '+id,package:'fixture.'+id,version:'1',versionCode:1,sources:[{id:String(id),name:'Source '+id,language:'en'}]}));
  const apk={repositories:[{url:'https://fixture.invalid/index.pb',catalog:{name:'User list',extensions}}],installed:extensions.map(extension=>({extension}))};
  window.__TAURI__={app:{getVersion:async()=>'test'},core:{invoke:async(name,args)=>{
   const snapshot=()=>({books:[],progress:[{bookId:'saved',chapterId:'one',page:7,updated:123}],categories:['Default'],settings:{...settings},dataDir:'source-layout-fixture'});
   if(name==='snapshot')return snapshot();if(name==='save_settings'){Object.assign(settings,args.settings);sessionStorage.setItem('settings-fixture',JSON.stringify(settings));return snapshot();}
   if(name==='download_queue'||name==='extension_list')return[];if(name==='apk_state')return apk;if(name==='cloud_status')return{configured:false,signedIn:false};if(name==='verification_plan')return{enabled:false};throw Error('Unexpected '+name);
  }},event:{listen:async()=>{}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>{}})}};
 });
 await page.goto(pathToFileURL(path.resolve('index.html')).href);await page.waitForFunction(()=>state.dataDir==='source-layout-fixture');
 await page.evaluate(()=>{state.page='Settings';featureState.settingsTab='storage';render()});
 assert.equal(await page.locator('[data-action=files-layout]').count(),mobile?0:2);
 await page.evaluate(()=>{skipFailedSource(userSources().find(s=>s.id==='apk:1'),'Not available in your country.');skipFailedSource(userSources().find(s=>s.id==='apk:2'),'Browser verification required');featureState.settingsTab='sources';render()});
 assert.equal(await page.locator('.extension-has-issue').count(),2);
 await page.locator('.source-manager-skips>summary').click();await page.waitForFunction(()=>sourceDisclosureOpen('skips',true)===false);
 await page.getByRole('searchbox',{name:'Find an extension',exact:true}).fill('Source');assert.equal(await page.locator('.source-manager-skips').evaluate(n=>n.open),false);
 const first=page.locator('.apk-extension-results>.extension-row').first();
 assert.equal(await first.evaluate(n=>getComputedStyle(n).borderRadius),'0px');
 await page.getByRole('button',{name:'Stacked',exact:true}).click();await page.waitForFunction(()=>state.settings.apkLayout==='stacked');
 assert.notEqual(await first.evaluate(n=>getComputedStyle(n).borderRadius),'0px');
 if(mobile)assert.equal(await first.locator('.extension-identity').evaluate(n=>getComputedStyle(n).flexDirection),'column');
 assert.equal(await page.locator('.source-manager-skips').evaluate(n=>n.open),false);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`test-artifacts/source-layout-stacked-${width}.png`,fullPage:true});
 await page.reload();await page.waitForFunction(()=>state.dataDir==='source-layout-fixture');await page.evaluate(()=>{state.page='Settings';featureState.settingsTab='sources';render()});
 assert.equal(await page.locator('.apk-layout-stacked').count(),1);
 await page.getByRole('button',{name:'List',exact:true}).click();await page.waitForFunction(()=>state.settings.apkLayout==='list');assert.equal(await first.evaluate(n=>getComputedStyle(n).borderRadius),'0px');
 if(mobile)assert.equal(await first.locator('.extension-identity').evaluate(n=>getComputedStyle(n).flexDirection),'row');
 assert.equal(await page.evaluate(()=>state.progress[0].page),7);assert.deepEqual(errors,[]);await page.close();
}console.log('PASS source issue badges, stable disclosures during search/layout changes, real list/card styling, saved layout after restart, mobile Files toggle removal and progress preservation');}
finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
