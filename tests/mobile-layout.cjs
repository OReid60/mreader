const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.MREADER_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const output = path.resolve('test-artifacts');
  fs.mkdirSync(output, { recursive: true });
  const errors = [];
  async function open(width, android) {
    const page = await browser.newPage({ viewport: { width, height: 780 }, ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' } : {}) });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const settings = { theme:'dark',language:'en',direction:'ltr',fit:'width',dataSaver:false,komgaUrl:'',komgaUser:'',...JSON.parse(sessionStorage.getItem('fixtureSettings')||'{}') };
      const books = [95,35,347,103,4,7].map((count,index) => ({ id:`test:${index}`, title:`Library title ${index + 1}`,source:'local',author:'Layout fixture',description:'Synthetic test fixture',tags:['Action'],favorite:false,status:'Local',path:'fixture.cbz',chapters:Array.from({length:count},(_,n)=>({id:`c:${index}:${n}`,number:String(n+1),title:'Chapter',pages:3,downloaded:false,path:''})) }));
      let categories=['Default','nsfw'];
      const snapshot = () => structuredClone({ books,progress:[],settings,categories,dataDir:'Layout test' });
      const extension={name:'MANGA Plus by SHUEISHA',package:'fixture.publisher',version:'1.6.1',versionCode:106001,api:'1.6',contentWarning:1,sources:[{id:'1998944621602463790',name:'MANGA Plus by SHUEISHA',language:'en'}]};
      const apk={repositories:[{url:'https://fixture.test/index.pb',catalog:{name:'Test catalog',extensions:[extension]}}],installed:[]};
      window.__TAURI__ = {
        core: { invoke: async (name,args) => {
          if (name === 'snapshot') return snapshot();
          if (name === 'mobile_download_start'){window.localCodeCounter=(window.localCodeCounter||0)+1;return {url:'http://192.168.1.2:1234/token'+window.localCodeCounter+'/',svg:'<svg viewBox="0 0 40 40"><rect width="40" height="40" fill="black"/></svg>',addresses:['192.168.1.2'],address:'192.168.1.2',expiresAt:Date.now()+300000,version:'0.3.19',bytes:15943808};}
          if (name === 'mobile_download_stop')return;
          if (name === 'save_settings') {Object.assign(settings,args.settings);sessionStorage.setItem('fixtureSettings',JSON.stringify(settings));return snapshot();}
          if(name==='download_queue')return [];
          if (name === 'extension_list') return [];
          if (name === 'apk_state') return structuredClone(apk);
          if (name === 'apk_install') {apk.installed=[{extension,repository:apk.repositories[0].url}];return structuredClone(apk);}
          if (name === 'apk_remove') {apk.installed=[];return structuredClone(apk);}
          if (name === 'cloud_status') return {configured:true,signedIn:false};
          if (name === 'source_prefer') {window.chosenSource=args.source;return;}
          if (name === 'cloud_sync') {
            const failed=!!window.failSourceSync;
            apk.installed=failed?[]:[{extension,repository:apk.repositories[0].url}];
            return {snapshot:snapshot(),status:{configured:true,signedIn:true},extensions:[],apk:structuredClone(apk),preferredSource:'apk:1998944621602463790',sourceChoices:[{kind:'apk',value:{name:extension.name,package:extension.package}}],sourceSyncErrors:failed?['Source download unavailable; retry sync']:[]};
          }
          if (name === 'open_chapter') return {pages:3,pdf:false};
          if (name === 'page_data') {
            if(!window.fixturePng){const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;canvas.getContext('2d').fillRect(0,0,400,600);window.fixturePng=fetch(canvas.toDataURL()).then(r=>r.arrayBuffer());}
            return(await window.fixturePng).slice(0);
          }
          if (name === 'save_progress') return;
          if (name === 'verification_plan') return {enabled:false};
          if (name === 'cover_data') throw Error('Synthetic cover is provided by the layout test');
          if (name === 'chapters') return structuredClone(books.find(book => book.id === args.bookId));
          if (name === 'search_source') return {books:structuredClone(books),total:books.length};
          if (name === 'edit_category') {
            if(args.action==='create')categories.push(args.name.trim());
            if(args.action==='rename'){categories=categories.map(n=>n===args.name?args.replacement:n);books.forEach(b=>b.tags=b.tags.map(t=>t==='mreader:category:'+args.name?'mreader:category:'+args.replacement:t));}
            if(args.action==='delete'){categories=categories.filter(n=>n!==args.name);books.forEach(b=>b.tags=b.tags.filter(t=>t!=='mreader:category:'+args.name));}
            return snapshot();
          }
          if (name === 'set_book_category') {
            const book = books.find(book => book.id === args.bookId);
            book.tags = args.category === 'Default' ? ['Action'] : ['Action','mreader:category:'+args.category];
            return snapshot();
          }
          throw Error(`Unexpected command: ${name}`);
        } },
        event:{listen:async()=>()=>{}},
        webviewWindow:{getCurrentWebviewWindow:()=>({onDragDropEvent:async()=>()=>{}})}
      };
    });
    await page.goto(pathToFileURL(path.resolve('index.html')).href);
    await page.waitForFunction(() => state.books.length === 6);
    await page.evaluate(() => {
      state.books.forEach((book,index) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="hsl(${index*52},50%,35%)"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="300" height="450" fill="url(#g)"/><path d="M0 320L300 80M0 400L300 160M0 240L240 0" stroke="#ffffff33" stroke-width="30"/><text x="20" y="80" fill="white" font-size="38" font-family="sans-serif">VOLUME ${index+1}</text></svg>`;
        coverCache.set(book.id,'data:image/svg+xml,'+encodeURIComponent(svg));
      });
      render();
    });
    return page;
  }
  try {
    const phone = await open(362,true);
    assert.equal(await phone.locator('.mobile-grid .card').count(),6);
    assert.equal(await phone.locator('.mobile-bottom button').count(),5);
    assert.equal(await phone.locator('.sidebar').count(),0);
    assert.equal(await phone.locator('.hero').count(),0);
    assert.equal(await phone.locator('.mobile-categories button').allTextContents().then(x=>x.join(',')),'Default,nsfw,Favorites');
    const columns = await phone.locator('.mobile-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns,3);
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    await phone.screenshot({path:path.join(output,'mobile-library-layout.png')});
    await phone.locator('.card[data-id="test:0"]').click();
    await phone.getByRole('button',{name:'Category: Default',exact:true}).click();
    await phone.getByRole('button',{name:'nsfw',exact:true}).last().click();
    await phone.locator('[data-action="close-detail"]').click();
    assert.equal(await phone.locator('.mobile-grid .card').count(),5);
    await phone.locator('[data-action="mobile-category"][data-category="nsfw"]').click();
    await phone.waitForFunction(()=>state.mobileCategory==='nsfw'&&!categorySlide);
    assert.equal(await phone.locator('.mobile-grid .card').count(),1);
    assert.equal(await phone.locator('.mobile-grid .card h3').textContent(),'Library title 1');
    await phone.evaluate(()=>navigate('Settings'));
    await phone.getByRole('button',{name:'Categories',exact:true}).click();
    await phone.locator('#category-name').fill('Action & Adventure');
    await phone.getByRole('button',{name:'Create category',exact:true}).click();
    await phone.waitForFunction(()=>state.categories.includes('Action & Adventure'));
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await phone.screenshot({path:path.join(output,'mobile-category-manager.png')});
    await phone.locator('[data-action="mobile-close-sheet"]').click();
    await phone.evaluate(()=>navigate('Library'));
    await phone.locator('[data-action="mobile-category"][data-category="nsfw"]').click();
    await phone.waitForFunction(()=>state.mobileCategory==='nsfw'&&!categorySlide);
    await phone.locator('.card[data-id="test:0"]').click();
    await phone.getByRole('button',{name:'Category: nsfw',exact:true}).click();
    await phone.locator('#mobile-sheet').getByRole('button',{name:'Action & Adventure',exact:true}).click();
    await phone.locator('[data-action="close-detail"]').click();
    await phone.evaluate(()=>navigate('Settings'));
    await phone.getByRole('button',{name:'Categories',exact:true}).click();
    await phone.locator('[data-action="mobile-edit-category"][data-name="Action & Adventure"]').click();
    await phone.locator('#category-name').fill('Adventure');
    await phone.getByRole('button',{name:'Save name',exact:true}).click();
    await phone.waitForFunction(()=>state.categories.includes('Adventure'));
    await phone.locator('[data-action="mobile-close-sheet"]').click();
    await phone.evaluate(()=>navigate('Library'));
    assert.equal(await phone.locator('.mobile-grid .card').count(),1);
    await phone.evaluate(()=>navigate('Settings'));
    await phone.getByRole('button',{name:'Categories',exact:true}).click();
    await phone.locator('[data-action="mobile-category-delete"][data-name="Adventure"]').click();
    await phone.getByRole('button',{name:'Delete category',exact:true}).click();
    await phone.waitForFunction(()=>!state.categories.includes('Adventure'));
    await phone.locator('[data-action="mobile-close-sheet"]').click();
    await phone.evaluate(()=>navigate('Library'));
    assert.equal(await phone.locator('.mobile-grid .card').count(),6);
    await phone.locator('[data-action="mobile-menu"]').click();
    await phone.locator('#mobile-sheet [data-page="Settings"]').click();
    assert(await phone.locator('#account-form').isVisible());
    await phone.locator('[data-action="apk-install"]').click();
    await phone.waitForFunction(()=>featureState.apk.installed.length===1);
    assert(await phone.locator('[data-action="apk-remove"]').isVisible());
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await phone.locator('.mobile-bottom [data-page="Browse"]').click();
    assert.equal(await phone.locator('#source option[value="apk:1998944621602463790"]').count(),1);
    await phone.locator('.mobile-bottom [data-page="Settings"]').click();
    await phone.locator('[data-action="apk-remove"]').click();
    await phone.waitForFunction(()=>featureState.apk.installed.length===0);
    await phone.locator('.mobile-bottom [data-page="Library"]').click();
    await phone.locator('[data-action="mobile-search"]').click();
    await phone.locator('#search').fill('not-present');
    await phone.waitForTimeout(350);
    assert.equal(await phone.locator('.mobile-grid .card').count(),0);
    const desktop = await open(1440,false);
    assert.equal(await desktop.locator('.sidebar').count(),1);
    assert.equal(await desktop.locator('.mobile-bottom').count(),0);
    await phone.evaluate(async()=>{
      navigationHistory.length=0;state.page='Library';state.mobileSearch=false;state.query='';render();
      await navigate('Browse');await navigate('Settings');
      if(!handleAppBack()||state.page!=='Browse')throw Error('Back must return to the previous tab');
      if(!handleAppBack()||state.page!=='Library')throw Error('Back must return to library');
      await showDetails(state.books[0].id);
      await openReader(state.books[0].id,state.books[0].chapters[0].id,0);
      if(!handleAppBack()||state.reader||!state.detail)throw Error('Reader back must return to title details');
      if(!handleAppBack()||state.detail)throw Error('Details back must return to library');
      showMobileSheet('filters');if(!handleAppBack()||document.querySelector('#mobile-sheet'))throw Error('Back must close sheets');
      state.mobileSearch=true;state.query='test';render();
      if(!handleAppBack()||state.mobileSearch||state.query)throw Error('Back must dismiss search');
      if(!handleAppBack()||handleAppBack()!==false)throw Error('Accidental root back must not close the app');
    });
    await desktop.evaluate(()=>{
      state.page='Library';state.mobileCategory='Default';state.query='';state.tab='All';
      const books=state.books;
      books[4].tags.push('mreader:category:nsfw');
      state.progress=[
        {bookId:books[0].id,chapterId:books[0].chapters[0].id,page:2,completed:false,updated:90},
        {bookId:books[0].id,chapterId:books[0].chapters[1].id,page:1,completed:false,updated:100},
        {bookId:books[1].id,chapterId:books[1].chapters[0].id,page:2,completed:true,updated:80},
        {bookId:books[2].id,chapterId:books[2].chapters.at(-1).id,page:2,completed:true,updated:70},
        {bookId:books[3].id,chapterId:'removed-chapter',page:1,completed:false,updated:200},
        {bookId:books[3].id,chapterId:books[3].chapters[0].id,page:1,completed:false,updated:60},
        {bookId:books[4].id,chapterId:books[4].chapters[0].id,page:1,completed:false,updated:110}
      ];indexProgress();render();
    });
    assert.equal(await desktop.locator('.continue-card').count(),3);
    assert.deepEqual(await desktop.locator('.continue-card h3').allTextContents(),['Library title 1','Library title 2','Library title 4']);
    assert((await desktop.locator('.continue-reading').boundingBox()).y>=(await desktop.locator('.main>.grid').boundingBox()).y+(await desktop.locator('.main>.grid').boundingBox()).height);
    assert.equal(await desktop.getByRole('button',{name:'Browse manga',exact:true}).count(),0);
    assert(await desktop.locator('.continue-card').nth(1).textContent().then(s=>s.includes('Next: Chapter 2')));
    await desktop.locator('.continue-reading').scrollIntoViewIfNeeded();
    await desktop.screenshot({path:path.join(output,'desktop-continue-reading.png')});
    await desktop.getByRole('button',{name:'Continue reading Library title 1',exact:true}).click();
    await desktop.waitForFunction(()=>state.reader?.chapter.id==='c:0:1'&&state.reader.page===1);
    await desktop.evaluate(async()=>{closeReader();applySnapshot(await api('snapshot'));render();});
    assert.equal(await desktop.locator('.continue-card').count(),0);
    await desktop.evaluate(()=>scrollTo(0,0));
    assert.equal(await desktop.locator('.breadcrumb').count(),0);
    assert.equal(await desktop.locator('.topbar .engine-status').count(),0);
    assert.equal(await desktop.locator('.sidebar [data-action="import"]').count(),1);
    assert.equal(await desktop.locator('.heading [data-action="import"]').count(),0);
    assert(await desktop.locator('.sidebar-account').evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight));
    await desktop.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
    assert.equal(await desktop.locator('.sidebar').evaluate(el=>Math.round(el.getBoundingClientRect().width)),76);
    assert.equal(await desktop.locator('.main').evaluate(el=>Math.round(el.getBoundingClientRect().left)),76);
    await desktop.getByRole('button',{name:'Expand sidebar',exact:true}).click();
    assert.equal(await desktop.locator('.sidebar').evaluate(el=>Math.round(el.getBoundingClientRect().width)),228);
    await desktop.evaluate(()=>navigate('Settings'));
    await desktop.getByRole('button',{name:'Categories',exact:true}).click();
    await desktop.locator('#category-name').fill('Desktop group');
    await desktop.getByRole('button',{name:'Create category',exact:true}).click();
    await desktop.waitForFunction(()=>state.categories.includes('Desktop group'));
    await desktop.locator('[data-action="mobile-close-sheet"]').click();
    await desktop.evaluate(()=>navigate('Library'));
    assert.equal(await desktop.locator('.category-tabs [data-category="Desktop group"]').count(),1);
    await desktop.evaluate(()=>navigate('Settings'));
    assert.equal(await desktop.locator('[data-action="apk-add-preset"]').count(),0);
    assert.equal(await desktop.locator('[data-action="extension-example"]').count(),0);
    assert.equal(await desktop.locator('input[name="dataSaver"]').count(),0);
    await desktop.getByRole('tab',{name:'Account & sync',exact:true}).click();
    assert.equal(await desktop.locator('#cloud-config-form').count(),0);
    assert(await desktop.locator('#account-form').isVisible());
    await desktop.getByRole('tab',{name:'Sources',exact:true}).click();
    await desktop.getByRole('button',{name:'Stacked',exact:true}).click();
    await desktop.waitForFunction(()=>state.settings.apkLayout==='stacked');
    assert.equal(await desktop.locator('.apk-layout-stacked').count(),1);
    await desktop.getByRole('button',{name:'List',exact:true}).click();
    await desktop.waitForFunction(()=>state.settings.apkLayout==='list');
    await desktop.getByRole('tab',{name:'Mobile app',exact:true}).click();
    await desktop.getByRole('button',{name:'Generate download code',exact:true}).click();
    await desktop.waitForFunction(()=>!!featureState.mobileDownload);
    assert.equal(await desktop.locator('.mobile-download-code svg').count(),1);
    assert((await desktop.locator('#mobile-download-link').innerText()).startsWith('http://192.168.1.2:1234/'));
    assert((await desktop.locator('#mobile-download-link').getAttribute('href')).startsWith('http://192.168.1.2:1234/'));
    assert(!(await desktop.locator('.mobile-install-instructions').innerText()).includes('supernova-pp1457'));
    await desktop.screenshot({path:path.join(output,'desktop-mobile-download.png')});
    const oldLocalLink=await desktop.locator('#mobile-download-link').getAttribute('href');await desktop.getByRole('button',{name:'Regenerate download code',exact:true}).click();
    await desktop.waitForFunction(old=>featureState.mobileDownload?.url!==old,oldLocalLink);await desktop.evaluate(()=>{featureState.mobileDownload.expiresAt=Date.now()-1;tickMobileDownload();});assert.equal(await desktop.locator('#mobile-download-link').count(),0);assert(await desktop.getByRole('button',{name:'Regenerate download code',exact:true}).isVisible());await desktop.getByRole('button',{name:'Regenerate download code',exact:true}).click();await desktop.waitForSelector('#mobile-download-link');
    assert.equal(await desktop.locator('#mobile-download-address').count(),0);
    assert.equal(await desktop.getByRole('button',{name:'Stop sharing',exact:true}).count(),1);
    await desktop.getByRole('tab',{name:'General',exact:true}).click();
    await desktop.getByRole('combobox',{name:'Startup page',exact:true}).selectOption('History');
    await desktop.locator('#settings-form button[type="submit"],#settings-form button').last().click();
    await desktop.waitForFunction(()=>state.settings.startPage==='History');
    for(const startPage of ['Library','Updates','History','Browse','Downloads']){
      await desktop.evaluate(async startPage=>{await api('save_settings',{settings:{...state.settings,startPage}});},startPage);
      await desktop.reload();
      await desktop.waitForFunction(startPage=>state.dataDir&&state.page===startPage,startPage);
      if(startPage==='Browse'){assert.equal(await desktop.locator('#source option[value="mangadex"]').count(),0);assert.equal(await desktop.locator('#source option[value="komga"]').count(),0);assert(await desktop.getByRole('button',{name:'Add sources in Settings',exact:true}).isVisible());}
    }
    for(const tab of ['Library','Updates','History','Browse','Downloads','Settings']){
      await desktop.evaluate(tab=>navigate(tab),tab);
      assert((await desktop.locator('.main').boundingBox()).y<2,`${tab} must start at the top`);
      assert((await desktop.locator('.heading').boundingBox()).y<115,`${tab} heading wastes top space`);
      if(tab!=='Settings')assert.equal(await desktop.locator('.topbar #search').count(),1);
    }
    await desktop.screenshot({path:path.join(output,'desktop-settings-compact.png')});
    for(const device of [phone,desktop]){
      await device.evaluate(async()=>{featureState.cloud.signedIn=true;await navigate('Browse');await syncAccount();});
      assert.equal(await device.locator('#source').inputValue(),'apk:1998944621602463790');
      assert.equal(await device.locator('#source option[value="apk:1998944621602463790"]').count(),1);
    }
    await desktop.screenshot({path:path.join(output,'desktop-browse-synced.png')});
    await phone.evaluate(()=>{state.settings.komgaUrl='https://fixture.test';render();});
    await phone.locator('#source').selectOption('komga');
    await phone.waitForFunction(()=>window.chosenSource==='komga'&&state.source==='komga');
    await phone.evaluate(async()=>{window.failSourceSync=true;await syncAccount();await navigate('Settings');});
    assert(await phone.getByRole('button',{name:'Remove from synced sources'}).isVisible());
    assert(await phone.getByText('Source download unavailable; retry sync',{exact:true}).isVisible());
    for(const device of [phone,desktop])await device.evaluate(()=>{featureState.cloud.signedIn=false;clearTimeout(featureState.syncTimer);});
    for(const device of [phone,desktop]){
      await device.evaluate(async()=>{state.dataDir='PRIVATE_DATA_LOCATION';state.settings.komgaUrl='https://private-server.invalid';state.settings.komgaUser='PRIVATE_SERVER_USER';featureState.settingsTab='general';await navigate('Settings');});
      assert.equal(await device.locator('[name="komgaUrl"],[name="komgaUser"],[name="komgaPassword"],.app-data-location,#cloud-config-form').count(),0);
      for(const section of ['general','account','sources','storage']){
        await device.evaluate(section=>{featureState.settingsTab=section;render();},section);
        const text=await device.locator('#app').innerText();
        for(const hidden of ['PRIVATE_DATA_LOCATION','PRIVATE_SERVER_USER','private-server.invalid','Managed service setup','compatibility runtime',' · API ','fixture.publisher','Rust core','WebView2'])assert(!text.includes(hidden),hidden+' should not appear in Settings');
      }
      await device.evaluate(()=>{featureState.settingsTab='general';render();});
      await device.locator('#settings-form button[type="submit"]').click();
      await device.waitForFunction(()=>state.settings.komgaUrl==='https://private-server.invalid'&&state.settings.komgaUser==='PRIVATE_SERVER_USER');
    }
    for (const readerPage of [phone, await open(900,true)]) {
      await readerPage.evaluate(() => {
        window.MreaderChrome = { setImmersive(value) { window.lastImmersive = value; } };
        const book = state.books[0];
        const url='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#d4c8b2"/><rect x="24" y="24" width="552" height="952" fill="#252830"/><text x="65" y="160" font-size="48" fill="white">Reader test page</text><path d="M50 240H550M50 500H550M300 240V920" stroke="#d4c8b2" stroke-width="12"/></svg>');
        state.reader = { book, chapter:book.chapters[0], page:2, total:12, url, loading:false, error:'' };
        renderReader();
      });
      assert(await readerPage.locator('#reader').isVisible());
      await readerPage.waitForFunction(()=>document.querySelector('.reading-page')?.naturalWidth>0);
      assert.equal(await readerPage.locator('.mobile-bottom').isVisible(),false);
      assert.equal(await readerPage.locator('.reader-bar').isVisible(),false);
      assert.equal(await readerPage.evaluate(()=>window.lastImmersive),true);
      const height = await readerPage.locator('.reading-stage').evaluate(el=>el.getBoundingClientRect().height);
      assert(height >= 780, 'Reader fills the available phone/tablet viewport');
      await readerPage.mouse.click((await readerPage.viewportSize()).width / 2,200);
      assert(await readerPage.locator('.reader-bar').isVisible());
      assert.equal(await readerPage.evaluate(()=>state.reader.page),2,'Center tap must not turn the page');
      await readerPage.locator('[data-action="fullscreen"]').click();
      await readerPage.locator('[data-action="fullscreen"]').click();
      assert.equal(await readerPage.locator('.reading-bottom').isVisible(),false);
      await readerPage.screenshot({path:path.join(output,`fullscreen-reader-${readerPage.viewportSize().width}.png`)});
      await readerPage.evaluate(()=>closeReader());
      assert(await readerPage.locator('.mobile-bottom').isVisible());
      assert.equal(await readerPage.evaluate(()=>window.lastImmersive),false);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS mobile layout: three columns, screenshot chrome, category move/filter, search, account access, desktop isolation, no overflow or JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
