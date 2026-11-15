const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MREADER_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  for(const width of [362,900]){
   const page=await browser.newPage({viewport:{width,height:780},userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    const chapters=Array.from({length:10},(_,i)=>({id:`c${i}`,number:String(i+1),title:`Chapter ${i+1}`,pages:i===1?3:8,path:'fixture.cbz'}));
    const books=[{id:'strip-book',title:'Strip fixture',source:'local',favorite:false,tags:[],chapters}];
    let settings={theme:'dark',language:'en',direction:'ltr',fit:'width',readerLayout:'continuous',dataSaver:false,komgaUrl:'',komgaUser:''};
    const progress=[];window.testProgress=progress;window.testPages=[];window.testChapters=[];window.activeUrls=new Set();
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);window.activeUrls.add(url);return url;};
    URL.revokeObjectURL=url=>{window.activeUrls.delete(url);revoke(url);};
    const snapshot=()=>structuredClone({books,settings,progress,dataDir:'test'});
    let image;
    window.__TAURI__={core:{invoke:async(name,args)=>{
     if(name==='snapshot')return snapshot();
     if(name==='cloud_status')return{configured:false,signedIn:false};
     if(name==='verification_plan')return{enabled:false};
     if(name==='extension_list')return[];
     if(name==='apk_state')return{installed:[],repositories:[]};
     if(name==='cover_data')throw Error('No fixture cover');
     if(name==='open_chapter'){window.testChapters.push(args.chapterId);return{pages:chapters.find(c=>c.id===args.chapterId).pages,pdf:false};}
     if(name==='page_data'){
      window.testPages.push([args.chapterId,args.page]);
      if(!image){const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.fillStyle='#c9b697';x.fillRect(0,0,400,300);x.fillStyle='#20252e';x.fillRect(12,12,376,276);x.fillStyle='white';x.font='28px sans-serif';x.fillText('Reader layout fixture',40,150);image=fetch(c.toDataURL('image/png')).then(r=>r.arrayBuffer());}
      return(await image).slice(0);
     }
     if(name==='save_progress'){const old=progress.findIndex(p=>p.chapterId===args.chapterId);if(old>=0)progress.splice(old,1);progress.push({...args,updated:Date.now()});return;}
     if(name==='save_settings'){settings={...args.settings};window.savedLayout=settings.readerLayout;return snapshot();}
     throw Error(`Unexpected command ${name}`);
    }},event:{listen:async()=>()=>{}},webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>()=>{}})}};
    window.MreaderChrome={setImmersive(){}};
   });
   await page.goto(pathToFileURL(path.resolve('index.html')).href);
   await page.waitForFunction(()=>state.books.length===1);
   await page.evaluate(()=>openReader('strip-book','c0',2));
   await page.waitForFunction(()=>state.reader?.strip && document.querySelectorAll('.strip-image[src]').length>0);
   assert.equal(await page.evaluate(()=>state.reader.page),2);
   assert.equal(await page.locator('.strip-chapter').count(),10);
   assert((await page.evaluate(()=>testPages.length))<75,'Must not download the entire book');
   assert((await page.locator('.strip-divider').allTextContents()).some(t=>t.includes('Page 3 / 8')&&t.includes('Next: page 4')));
   assert.equal(await page.locator('.strip-divider').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(0, 0, 0)');
   await page.evaluate(async()=>{await state.reader.strip.jump(state.reader.book.chapters[1],2);await state.reader.strip.move(1);});
   assert.equal(await page.evaluate(()=>state.reader.chapter.id),'c2');
   assert.equal(await page.evaluate(()=>state.reader.page),0);
   await page.evaluate(()=>document.querySelector('.strip-page[data-chapter="c2"][data-page="1"]').scrollIntoView({block:'start'}));
   await page.waitForFunction(()=>state.reader.chapter.id==='c2'&&state.reader.page===1,{},{timeout:8000}).catch(async error=>{
    console.error(await page.evaluate(()=>({chapter:state.reader.chapter.id,page:state.reader.page,top:document.querySelector('#reader').scrollTop,cells:[...document.querySelectorAll('.strip-page[data-chapter="c2"]')].map(e=>({page:e.dataset.page,top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,loaded:!!e.querySelector('img[src]')}))})));
    await page.screenshot({path:'test-artifacts/continuous-reader-failure.png'});throw error;
   });
   await page.evaluate(()=>flushStripProgress());
   assert.equal(await page.evaluate(()=>testProgress.find(p=>p.chapterId==='c2').page),1);
   await page.evaluate(()=>{state.reader.controlsVisible=true;applyReaderChrome();});
   await page.locator('#reader-fit').selectOption('height');
   await page.waitForFunction(()=>state.reader?.strip && !state.reader.loading);
   await page.evaluate(()=>state.reader.strip.ready);
   await page.evaluate(()=>setReaderFullscreen(true));
   await page.setViewportSize({width,height:640});
   await page.waitForTimeout(80);
   assert.equal(await page.evaluate(()=>state.reader.chapter.id),'c2');
   assert.equal(await page.evaluate(()=>state.reader.page),1,'Viewport/system-bar changes must preserve the reading position');
   await page.setViewportSize({width,height:780});
   await page.waitForTimeout(80);
   assert.equal(await page.evaluate(()=>state.reader.page),1);
   assert((await page.evaluate(()=>activeUrls.size))<=12,'Decoded page URLs must stay bounded');
   assert.equal(await page.locator('.mobile-bottom').isVisible(),false);
   await page.evaluate(()=>{state.reader.controlsVisible=true;applyReaderChrome();});
   await page.locator('#reader-layout').selectOption('paged');
   await page.waitForFunction(()=>state.reader&&!state.reader.loading&&!state.reader.strip&&document.querySelector('.reading-page')?.naturalWidth>0);
   assert.equal(await page.evaluate(()=>savedLayout),'paged');
   await page.evaluate(()=>setReaderFullscreen(true));
   const centered=await page.locator('.reading-page').evaluate(image=>{const a=image.getBoundingClientRect(),b=image.parentElement.getBoundingClientRect();return Math.abs(a.top+a.height/2-b.top-b.height/2)<2&&Math.abs(a.left+a.width/2-b.left-b.width/2)<2;});
   assert(centered,'Single pages must be centered horizontally and vertically');
   await page.screenshot({path:`test-artifacts/centered-reader-${width}.png`});
   await page.evaluate(()=>{state.reader.controlsVisible=true;applyReaderChrome();});
   await page.locator('#reader-layout').selectOption('continuous');
   await page.waitForFunction(()=>state.reader?.strip && !state.reader.loading);
   await page.evaluate(()=>state.reader.strip.ready);
   assert.equal(await page.evaluate(()=>savedLayout),'continuous');
   assert.equal(await page.evaluate(()=>state.reader.chapter.id),'c2');
   assert.equal(await page.evaluate(()=>state.reader.page),1);
   await page.screenshot({path:`test-artifacts/continuous-reader-${width}.png`});
   await page.evaluate(async()=>{closeReader();await flushStripProgress();});
   assert.equal(await page.evaluate(()=>activeUrls.size),0,'Closing must revoke all decoded image URLs');
   assert(await page.locator('.mobile-bottom').isVisible());
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS continuous reader: phone/tablet centering, saved layout selection, lazy loading, cross-chapter scroll/navigation, visible-page progress, bounded images, resume and cleanup');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
