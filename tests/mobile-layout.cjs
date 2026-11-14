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
      const settings = { theme:'dark',language:'en',direction:'ltr',fit:'width',dataSaver:false,komgaUrl:'',komgaUser:'' };
      const books = [95,35,347,103,4,7].map((count,index) => ({ id:`test:${index}`, title:`Library title ${index + 1}`,source:'local',author:'Layout fixture',description:'Synthetic test fixture',tags:['Action'],favorite:false,status:'Local',path:'fixture.cbz',chapters:Array.from({length:count},(_,n)=>({id:`c:${index}:${n}`,number:String(n+1),title:'Chapter',pages:3,downloaded:false,path:''})) }));
      const snapshot = () => structuredClone({ books,progress:[],settings,dataDir:'Layout test' });
      window.__TAURI__ = {
        core: { invoke: async (name,args) => {
          if (name === 'snapshot') return snapshot();
          if (name === 'extension_list') return [];
          if (name === 'cloud_status') return {configured:true,signedIn:false};
          if (name === 'verification_plan') return {enabled:false};
          if (name === 'cover_data') throw Error('Synthetic cover is provided by the layout test');
          if (name === 'chapters') return structuredClone(books.find(book => book.id === args.bookId));
          if (name === 'search_source') return {books:structuredClone(books),total:books.length};
          if (name === 'set_book_category') {
            const book = books.find(book => book.id === args.bookId);
            book.tags = args.category === 'nsfw' ? ['Action','mreader:category:nsfw'] : ['Action'];
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
    assert.equal(await phone.locator('.mobile-categories button').allTextContents().then(x=>x.join(',')),'Default,nsfw');
    const columns = await phone.locator('.mobile-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(columns,3);
    assert(await phone.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
    await phone.screenshot({path:path.join(output,'mobile-library-layout.png')});
    await phone.locator('.card[data-id="test:0"]').click();
    await phone.getByRole('button',{name:'Move to nsfw',exact:true}).click();
    await phone.locator('[data-action="close-detail"]').click();
    assert.equal(await phone.locator('.mobile-grid .card').count(),5);
    await phone.locator('[data-action="mobile-category"][data-category="nsfw"]').click();
    assert.equal(await phone.locator('.mobile-grid .card').count(),1);
    assert.equal(await phone.locator('.mobile-grid .card h3').textContent(),'Library title 1');
    await phone.locator('[data-action="mobile-menu"]').click();
    await phone.locator('#mobile-sheet [data-page="Settings"]').click();
    assert(await phone.locator('#account-form').isVisible());
    await phone.locator('.mobile-bottom [data-page="Library"]').click();
    await phone.locator('[data-action="mobile-search"]').click();
    await phone.locator('#search').fill('not-present');
    await phone.waitForTimeout(350);
    assert.equal(await phone.locator('.mobile-grid .card').count(),0);
    const desktop = await open(1440,false);
    assert.equal(await desktop.locator('.sidebar').count(),1);
    assert.equal(await desktop.locator('.mobile-bottom').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS mobile layout: three columns, screenshot chrome, category move/filter, search, account access, desktop isolation, no overflow or JavaScript errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
