const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{for(const width of [1440,393]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.testCalls=[];window.testEvents={};window.failOnce=true;window.fixtureJobs=[];
   const chapters=Array.from({length:3},(_,i)=>({id:'c'+i,number:String(i+1),title:'Chapter '+(i+1),pages:2,path:'',downloaded:i===0,group:''}));
   const book={id:'test:a',remoteId:'/test',title:'Test manga',source:'apk:1',author:'Author',tags:['mreader:update:c2'],status:'Ongoing',cover:'',chapters};
   const settings={theme:'dark',startPage:'Library',language:'en',direction:'ltr',fit:'width',komgaUrl:'',komgaUser:'',readerLayout:'paged',apkLayout:'list'};
   const snapshot=()=>({books:[structuredClone(book)],progress:[],settings,categories:['Default','nsfw'],dataDir:'fixture'});
   const extension={name:'Fixture',package:'fixture',sources:[{id:'1',name:'Source A',language:'en'},{id:'2',name:'Source B',language:'en'}],versionCode:1};
   window.__TAURI__={core:{invoke:async(name,args)=>{
    window.testCalls.push({name,args});
    if(name==='extension_list')return [];
    if(name==='apk_state')return {repositories:[],installed:[{extension}]};
    if(name==='cloud_status')return {configured:true,signedIn:false};
    if(name==='verification_plan')return {enabled:false};
    if(name==='download_queue')return structuredClone(window.fixtureJobs);
     if(name==='snapshot')return snapshot();
    if(name==='cover_data')throw Error('No fixture cover');
    if(name==='save_progress')return;
    if(name==='search_source')return {books:[{...structuredClone(book),id:'result:'+args.source,source:args.source,chapters:[]}],total:1};
    if(name==='preview_source_book')return {...args.book,chapters:chapters.slice(0,args.book.source==='apk:2'?3:1)};
    if(name==='download_enqueue'){
      const ids=book.chapters.filter(c=>!c.downloaded&&(!args.chapterIds||args.chapterIds.includes(c.id))).map(c=>c.id);
      const job={id:book.id,title:book.title,pending:ids,total:ids.length,done:0,failed:[],active:null,paused:false,pageDone:0,pageTotal:0};window.fixtureJobs=[job];
      setTimeout(async()=>{while(job.pending.length){job.active=job.pending.shift();job.pageDone=1;job.pageTotal=2;window.testEvents['download-queue']?.({payload:structuredClone(window.fixtureJobs)});await new Promise(r=>setTimeout(r,80));
       if(job.active==='c2'&&window.failOnce){window.failOnce=false;job.failed.push({id:job.active,error:'Source temporarily unavailable'});}else{book.chapters.find(c=>c.id===job.active).downloaded=true;job.done++;}
       job.active=null;window.testEvents['download-queue']?.({payload:structuredClone(window.fixtureJobs)});
      }},20);return structuredClone(window.fixtureJobs);
    }
    throw Error('Unexpected '+name);
   }},event:{listen:async(name,handler)=>{window.testEvents[name]=handler;}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>{}})}};
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href);
  await page.waitForFunction(()=>state.dataDir==='fixture'&&!!window.testEvents['download-progress']);
  assert.equal(await page.locator('[name="komgaUrl"]').count(),0);
  await page.evaluate(()=>{state.page='Settings';render();});
  assert.equal(await page.locator('[name="komgaUrl"]').count(),0);
  await page.evaluate(()=>{state.page='Library';render();});
  assert.equal(await page.locator('[data-action="mobile-manage-categories"]').count(),0);
  assert.equal(await page.locator('.new-chapters').count(),1);
  if(width===1440){
    const aligned=await page.evaluate(()=>{const h=document.querySelector('.library-heading'),c=h.querySelector('.category-tabs');return Math.abs(h.getBoundingClientRect().top-c.getBoundingClientRect().top)<35;});
    assert(aligned);await page.screenshot({path:'test-artifacts/compact-library-1440.png'});
  }
  await page.evaluate(()=>showDetails('test:a'));
  assert.equal(await page.locator('[data-action="download-all"]').count(),1);
  const task=page.evaluate(()=>downloadAllChapters('test:a'));
  await page.waitForFunction(()=>document.querySelector('.download-queue')?.textContent.includes('1/2 pages'));
  await task;
  await page.waitForFunction(()=>downloadJobs.get('test:a')?.failed.length===1);
  assert.equal(await page.evaluate(()=>downloadJobs.get('test:a').failed.length),1);
  assert.equal(await page.evaluate(()=>state.books[0].chapters.filter(c=>c.downloaded).length),2);
  await page.evaluate(()=>downloadAllChapters('test:a'));
  await page.waitForFunction(()=>state.books[0].chapters.every(c=>c.downloaded));
  assert.equal(await page.evaluate(()=>testCalls.filter(c=>c.name==='download_chapter'&&c.args.chapterId==='c0').length),0);
  await page.evaluate(async()=>{await api('save_progress',{bookId:'test:a',chapterId:'c2',page:0,completed:false});renderDetails();});
  assert.equal(await page.locator('.chapter-read').count(),2);
  assert.equal(await page.locator('.chapter-read [data-action="read"]').count(),2);
  await page.evaluate(()=>{closeDetail();state.page='Browse';state.source='all';});
  await page.evaluate(()=>searchSource());
  assert.equal(await page.evaluate(()=>state.catalog.length),1);
  await page.evaluate(()=>showDetails(state.catalog[0].id));
  assert.equal(await page.evaluate(()=>state.detail.source),'apk:2');
  assert((await page.locator('.source-alternatives').innerText()).includes('Primary'));
  const before=await page.evaluate(()=>testCalls.filter(c=>c.name==='search_source').length);
  await page.evaluate(()=>{closeDetail();return searchSource();});
  assert.equal(await page.evaluate(()=>testCalls.filter(c=>c.name==='search_source').length),before);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS desktop/mobile: bulk download progress, skip downloaded, failure/retry, inferred read styling/reread, compact categories, new badges, hidden Komga, unified results, primary chapter count and cached Browse');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
