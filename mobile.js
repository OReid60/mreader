// Android and Linux WebViews need a bundled PDF viewer. Render one page at a time
// so large books don't allocate a canvas for every page.
function isAndroid() {
  return /Android/i.test(globalThis.navigator?.userAgent || "");
}

// Continuous reading keeps chapter/page identity separate from decoded images.
// Only nearby pages are fetched; old image URLs are released as the reader moves.
let stripProgressWrites = Promise.resolve();
async function flushStripProgress() {
  const strip = state.reader?.strip;
  if (strip) strip.flush();
  await stripProgressWrites;
}
function stopReaderStrip() {
  const strip = state.reader?.strip;
  if (!strip) return stripProgressWrites.catch(() => {});
  strip.flush();
  strip.destroy();
  state.reader.strip = null;
  return stripProgressWrites.catch(toast);
}
function mountReaderStrip(reader, root) {
  root.style.overflowAnchor = 'none';
  const stage = root.querySelector('.reading-stage');
  stage.className = `reading-strip fit-${state.settings.fit}`;
  stage.removeAttribute('data-action');
  stage.replaceChildren();
  const status = document.createElement('p');
  status.className = 'strip-status';
  status.setAttribute('role', 'status');
  stage.append(status);
  const chapters = reader.book.chapters;
  const sections = new Map(), cells = new Map(), loaded = new Set(), nearbyCells = new Set();
  const jobs = [];
  let running = 0, destroyed = false, initializing = true, progressTimer, pendingProgress, scrollFrame, viewAnchor;
  let viewportWidth=root.clientWidth, viewportHeight=root.clientHeight;
  const active = () => !destroyed && state.reader === reader;
  const near = (element, margin = root.clientHeight) => {
    const bounds = element.getBoundingClientRect(), view = root.getBoundingClientRect();
    return bounds.bottom > view.top - margin && bounds.top < view.bottom + margin;
  };
  function report(error) { if (active()) status.textContent = readerErrorMessage(error); }
  function enqueue(work, priority = false) {
    return new Promise((resolve, reject) => {
      jobs[priority ? 'unshift' : 'push']({work, resolve, reject});
      pump();
    });
  }
  function pump() {
    while (running < 2 && jobs.length) {
      const task = jobs.shift();
      running++;
      Promise.resolve().then(() => active() ? task.work() : undefined)
        .then(task.resolve, task.reject).finally(() => { running--; pump(); });
    }
  }
  function release(cell) {
    if (cell.pinned) return;
    if (!cell.url) return;
    cell.cancelDecode?.();
    cell.cancelDecode=null;
    cell.frame.style.height = `${cell.frame.getBoundingClientRect().height}px`;
    cell.image.removeAttribute('src');
    cell.image.hidden = true;
    cell.frame.dataset.loaded = 'false';
    URL.revokeObjectURL(cell.url);
    cell.url = null;
    loaded.delete(cell);
  }
  function trim() {
    for (const cell of loaded) if (!near(cell.element, root.clientHeight * 1.5)) release(cell);
    if (loaded.size > 12) {
      const line = root.getBoundingClientRect().top + root.clientHeight / 2;
      const farthest = [...loaded].sort((a,b) => Math.abs(b.element.getBoundingClientRect().top-line)-Math.abs(a.element.getBoundingClientRect().top-line));
      for (const cell of farthest) {
        if (loaded.size <= 12) break;
        if (!near(cell.element, 0)) release(cell);
      }
    }
  }
  function loadPage(cell, priority = false) {
    if (cell.pending) return cell.pending.then(() => priority && !cell.url && active() ? loadPage(cell,true) : undefined);
    if (cell.url) return Promise.resolve();
    if (cell.failed && !priority) return Promise.resolve();
    cell.failed=false;
    cell.decode=null;
    cell.frame.querySelector('button')?.remove();
    cell.pending = enqueue(async () => {
      if (!priority && !near(cell.element, root.clientHeight)) return;
      const bytes = await api('page_data', {bookId:reader.book.id, chapterId:cell.chapter.id, page:cell.page});
      if (!active()) return;
      if (!priority && !near(cell.element, root.clientHeight)) return;
      const url = URL.createObjectURL(new Blob([bytes], {type:detectMime(bytes)}));
      cell.url = url;
      loaded.add(cell);
      cell.image.hidden = false;
      cell.image.src = url;
      const canceled=new Promise(resolve=>{cell.cancelDecode=resolve;});
      cell.decode=Promise.race([cell.image.decode(),canceled]).then(() => {
        if (!active() || cell.url !== url) return;
        const saved = initializing ? null : anchor();
        cell.frame.style.aspectRatio = `${cell.image.naturalWidth} / ${cell.image.naturalHeight}`;
        cell.frame.style.height = '';
        cell.frame.dataset.loaded = 'true';
        restoreAnchor(saved);
        trim();
        schedule();
      }).catch(error=>{if(cell.url!==url)return;release(cell);throw error;}).finally(()=>{if(cell.url===url)cell.cancelDecode=null;});
    }, priority).then(()=>cell.decode).catch(error => {
      if (!active()) return;
      cell.failed=true;
      const retry = document.createElement('button');
      retry.className = 'strip-retry';
      retry.textContent = `Page ${cell.page + 1} could not load · Retry`;
      retry.title = String(error);
      retry.addEventListener('click', () => loadPage(cell, true).catch(report));
      cell.frame.append(retry);
      if (priority) throw error;
    }).finally(() => { cell.pending = null; if(active() && !cell.url && !cell.failed && nearbyCells.has(cell))schedule(); });
    return cell.pending;
  }
  const pageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const cell = cells.get(entry.target);
      if (!cell) continue;
      if (entry.isIntersecting) {nearbyCells.add(cell);loadPage(cell).catch(report);}
      else {nearbyCells.delete(cell);release(cell);}
    }
  }, {root, rootMargin:'800px 0px'});
  function anchor() {
    const top = root.getBoundingClientRect().top + root.querySelector('.reader-bar').getBoundingClientRect().height;
    const visible = element => {const b=element.getBoundingClientRect();return b.bottom>top && b.top<top+root.clientHeight;};
    const current=sections.get(reader.chapter.id)?.pages?.[reader.page]?.element;
    const element = current && visible(current) ? current : [...cells.keys()].find(visible) || [...sections.values()].map(s=>s.element).find(visible);
    return element ? {element, top:element.getBoundingClientRect().top} : null;
  }
  function restoreAnchor(saved) {
    if (saved?.element.isConnected) root.scrollTop += saved.element.getBoundingClientRect().top - saved.top;
  }
  async function expand(chapter, force = false) {
    const section = sections.get(chapter.id);
    if (section.pages) return section;
    if (section.pending) return section.pending;
    section.pending = enqueue(async () => {
      if (!force && !near(section.element, root.clientHeight)) return section;
      if(!navigator.onLine && reader.book.source!=='local' && !chapter.downloaded && !(chapter.id===reader.chapter.id&&initializing)){
        const retry=section.element.querySelector('button');
        if(retry){retry.disabled=false;retry.textContent=`${chapter.number?'Chapter '+chapter.number:chapter.title||'Chapter'} · Not downloaded on this device`;}
        if(force){const error=Error('This chapter is not downloaded on this device. Connect to download it before reading offline.');error.offlineChapter=true;throw error;}
        return section;
      }
      const meta = chapter.id === reader.chapter.id && initializing
        ? {pages:reader.total, pdf:reader.pdf}
        : await api('open_chapter', {bookId:reader.book.id, chapterId:chapter.id});
      if (!active()) return section;
      if (meta.pdf) throw Error('PDF chapters use the single-page reader. Select Single page to open this chapter.');
      if (!meta.pages) throw Error('This chapter has no readable pages.');
      chapter.pages = meta.pages;
      const saved = initializing ? null : anchor();
      section.element.replaceChildren();
      const heading = document.createElement('h2');
      heading.className = 'strip-chapter-heading';
      heading.textContent = `Chapter ${chapter.number} · ${chapter.title || reader.book.title}`;
      section.element.append(heading);
      section.pages = [];
      for (let page=0; page<meta.pages; page++) {
        const element = document.createElement('article');
        element.className = 'strip-page';
        element.dataset.chapter = chapter.id;
        element.dataset.page = page;
        const frame = document.createElement('div');
        frame.className = 'strip-frame';
        frame.dataset.label = `Page ${page+1}`;
        const image = document.createElement('img');
        image.className = 'strip-image';
        image.alt = `Chapter ${chapter.number}, page ${page+1}`;
        image.decoding = 'async';
        image.hidden = true;
        frame.append(image);
        const divider = document.createElement('div');
        divider.className = 'strip-divider';
        const next = chapters[chapters.indexOf(chapter)+1];
        const current = document.createElement('span'), following = document.createElement('span');
        current.textContent = `Chapter ${chapter.number} · Page ${page+1} / ${meta.pages}`;
        following.textContent = page+1<meta.pages ? `Next: page ${page+2}` : next ? `Next: chapter ${next.number}` : 'End of available chapters';
        divider.append(current, following);
        element.append(frame, divider);
        section.element.append(element);
        const cell = {element, frame, image, chapter, page, total:meta.pages, url:null, pending:null};
        section.pages.push(cell);
        cells.set(element,cell);
        pageObserver.observe(element);
      }
      restoreAnchor(saved);
      return section;
    }, force).catch(error => {
      if (active()) {
        const retry = section.element.querySelector('button');
        if (retry&&!error.offlineChapter) { retry.disabled=false; retry.textContent=`Chapter ${chapter.number} · Retry loading`; retry.title=String(error); }
        report(error);
      }
      throw error;
    }).finally(() => { section.pending=null; });
    return section.pending;
  }
  const chapterObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) expand(sections.get(entry.target.dataset.chapter).chapter).catch(() => {});
  }, {root, rootMargin:'800px 0px'});
  for (const chapter of chapters) {
    const element=document.createElement('section');
    element.className='strip-chapter';
    element.dataset.chapter=chapter.id;
    const button=document.createElement('button');
    button.className='strip-chapter-load';
    button.textContent=`Chapter ${chapter.number} · ${chapter.title || 'Load chapter'}`;
    button.addEventListener('click', () => expand(chapter,true).then(()=>schedule()).catch(report));
    element.append(button);
    stage.append(element);
    sections.set(chapter.id, {element, chapter, pages:null, pending:null});
  }
  function updateChrome() {
    root.querySelector('.reader-title small').textContent=`Chapter ${reader.chapter.number} · ${reader.chapter.title || reader.chapter.group || ''}`;
    root.querySelector('.page-jump').innerHTML=`<input id="page-jump" type="number" min="1" max="${reader.total}" value="${reader.page+1}" aria-label="Jump to page"> / ${reader.total}`;
    root.querySelector('[data-action="previous-page"]').disabled=reader.page===0 && reader.chapter===chapters[0];
    root.querySelector('[data-action="next-page"]').disabled=reader.page===reader.total-1 && reader.chapter===chapters[chapters.length-1];
  }
  function record(cell) {
    reader.chapter=cell.chapter;
    reader.page=cell.page;
    reader.total=cell.total;
    updateChrome();
    const key=`${cell.chapter.id}:${cell.page}`;
    if (reader.strip.lastProgress===key) return;
    reader.strip.lastProgress=key;
    pendingProgress={bookId:reader.book.id, chapterId:cell.chapter.id, page:cell.page, completed:!!progressFor(reader.book.id,cell.chapter.id)?.completed || cell.page===cell.total-1};
    clearTimeout(progressTimer);
    progressTimer=setTimeout(flush,350);
  }
  function flush() {
    clearTimeout(progressTimer);
    const progress=pendingProgress;
    pendingProgress=null;
    if (!progress) return;
    state.progress=state.progress.filter(p=>!(p.bookId===progress.bookId && p.chapterId===progress.chapterId));
    state.progress.unshift({...progress,updated:Date.now()});
    indexProgress();
    stripProgressWrites=stripProgressWrites.catch(()=>{}).then(()=>api('save_progress',progress));
    stripProgressWrites.catch(error => { if (!pendingProgress) pendingProgress=progress; report(error); });
  }
  function measure() {
    scrollFrame=null;
    if (!active() || initializing) return;
    preserveResize();
    for(const cell of nearbyCells)if(!cell.url&&!cell.pending&&!cell.failed)loadPage(cell).catch(report);
    trim();
    const toolbar=root.querySelector('.reader-bar').getBoundingClientRect().height;
    const line=root.getBoundingClientRect().top+toolbar+Math.min(80,(root.clientHeight-toolbar)*0.1);
    const visible=[...loaded].filter(cell=>cell.frame.dataset.loaded==='true' && near(cell.element,0));
    visible.sort((a,b)=>{
      const distance=cell=>{const rect=cell.element.getBoundingClientRect();return line<rect.top?rect.top-line:line>rect.bottom?line-rect.bottom:0;};
      return distance(a)-distance(b);
    });
    if (visible[0]) record(visible[0]);
    viewAnchor=anchor();
  }
  function preserveResize() {
    if(root.clientWidth===viewportWidth && root.clientHeight===viewportHeight)return;
    if(!initializing)restoreAnchor(viewAnchor);
    viewportWidth=root.clientWidth;viewportHeight=root.clientHeight;
    viewAnchor=anchor();
  }
  function onResize(){if(active()){preserveResize();schedule();}}
  function schedule() { if (!scrollFrame && active()) scrollFrame=requestAnimationFrame(measure); }
  async function jump(chapter,page) {
    const section=await expand(chapter,true);
    if (!active() || !section.pages) return;
    const cell=section.pages[Math.max(0,Math.min(section.pages.length-1,page))];
    cell.pinned=true;
    try { await loadPage(cell,true); }
    finally { cell.pinned=false; }
    if (!active()) return;
    if (!cell.url) throw Error(`Page ${cell.page+1} could not load. Tap Retry on the page.`);
    cell.element.scrollIntoView({block:'start'});
    initializing=false;
    record(cell);
    viewAnchor=anchor();
    for (const nearby of section.pages.slice(Math.max(0,cell.page-1),cell.page+3)) loadPage(nearby).catch(report);
  }
  const session={root,ready:null,lastProgress:null,flush,jump,captureView(){const saved=anchor();return()=>{restoreAnchor(saved);viewAnchor=anchor();};}, async move(delta) {
    let chapter=reader.chapter, page=reader.page+delta;
    if (page<0) {
      chapter=chapters[chapters.indexOf(chapter)-1];
      if (!chapter) return;
      const section=await expand(chapter,true);
      page=section.pages.length-1;
    } else if (page>=reader.total) {
      chapter=chapters[chapters.indexOf(chapter)+1];
      if (!chapter) return;
      page=0;
    }
    await jump(chapter,page);
  },destroy() {
    destroyed=true;
    pageObserver.disconnect();chapterObserver.disconnect();
    clearTimeout(progressTimer);
    if(scrollFrame)cancelAnimationFrame(scrollFrame);
    root.removeEventListener('scroll',schedule);
    window.removeEventListener('resize',onResize);
    for(const cell of loaded){cell.pinned=false;release(cell);}
  }};
  reader.strip=session;
  root.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',onResize,{passive:true});
  let pointer;
  stage.addEventListener('pointerdown',event=>{pointer={x:event.clientX,y:event.clientY};},{passive:true});
  stage.addEventListener('click',event=>{
    if (event.target.closest('button,input,select,a') || pointer && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>12) return;
    const rect=root.getBoundingClientRect(), x=(event.clientX-rect.left)/rect.width;
    if (x>=1/3 && x<=2/3) {reader.controlsVisible=!reader.controlsVisible;applyReaderChrome();}
    else session.move((x<1/3?-1:1)*(state.settings.direction==='rtl'?-1:1)).catch(report);
  });
  session.ready=jump(reader.chapter,reader.page).then(()=>{
    if(active())for(const section of sections.values())chapterObserver.observe(section.element);
  }).catch(error=>{
    initializing=false;report(error);
    if(active())for(const section of sections.values())chapterObserver.observe(section.element);
  });
}
function usesCanvasPdf() {
  return /Android|Linux/i.test(globalThis.navigator?.userAgent || "");
}
async function openMobilePdf(url) {
  const pdfjs = await import("./vendor/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.mjs";
  return pdfjs.getDocument({ url, isEvalSupported: false }).promise;
}
async function renderMobilePdf(reader, canvas) {
  if (!canvas || !reader.pdfDocument) return;
  reader.pdfRender?.cancel();
  canvas.dataset.action = "page-click";
  const page = await reader.pdfDocument.getPage(reader.page + 1);
  if (!canvas.isConnected) return;
  const natural = page.getViewport({ scale: 1 });
  const available = Math.max(240, canvas.parentElement.clientWidth - 16);
  const scale = Math.min(2, globalThis.devicePixelRatio || 1) * Math.min(2, available / natural.width);
  const viewport = page.getViewport({ scale });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = `${viewport.width / Math.min(2, globalThis.devicePixelRatio || 1)}px`;
  reader.pdfRender = page.render({ canvasContext: canvas.getContext("2d"), viewport });
  try { await reader.pdfRender.promise; }
  catch (error) { if (error.name !== "RenderingCancelledException") throw error; }
}
// Mobile library presentation; the existing Rust commands still own the data.
function useMobileLayout() {
  return isAndroid() || (globalThis.innerWidth || globalThis.window?.innerWidth || 1200) <= 760;
}
function chapterOrder(){try{return localStorage.getItem('mreader:chapter-order')==='desc'?'desc':'asc';}catch{return 'asc';}}
function orderedChapters(book){const chapters=[...book.chapters];chapters.sort((a,b)=>{const an=a.number?.trim()!==''?Number(a.number):NaN,bn=b.number?.trim()!==''?Number(b.number):NaN;return Number.isFinite(an)&&Number.isFinite(bn)?an-bn:0;});return chapterOrder()==='desc'?chapters.reverse():chapters;}
function mangaDownloadBadge(book){return book.chapters.some(c=>c.downloaded)?button('manga-download-info',icon('downloads'),'secondary manga-download-badge',`data-id="${esc(book.id)}" aria-label="Downloaded chapters" title="Downloaded chapters"`):'';}
function bookCategory(book) {
  const category = book.tags?.find(tag => tag.startsWith('mreader:category:'))?.slice('mreader:category:'.length);
  return category && (!state.categories || state.categories.includes(category)) ? category : 'Default';
}
function matchesLibraryCategory(book,name){return name==='Favorites'?book.favorite:bookCategory(book)===name;}
function libraryCategoryNames(){return [...new Set([...(state.categories||['Default','nsfw']),'Favorites'])];}
function categoryTabs(mobile = false) {
  const names = libraryCategoryNames();
  return `<nav class="${mobile ? 'mobile-categories' : 'category-tabs'}" aria-label="Library categories">${button('mobile-manage-categories','+','category-add','aria-label="Manage categories" title="Manage categories"')}${names.map(name => `<button data-action="mobile-category" data-category="${esc(name)}" class="${(state.mobileCategory || 'Default') === name ? 'active' : ''}">${esc(name)}</button>`).join('')}</nav>`;
}
function categoryLayer(title, content) {
  closeMobileSheet();
  const layer = document.createElement('div');
  layer.id='mobile-sheet'; layer.className='modal-backdrop mobile-sheet-backdrop category-backdrop';
  layer.innerHTML=`<section class="modal mobile-sheet category-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${content}<p class="category-error" role="alert"></p>${button('mobile-close-sheet','Close','secondary')}</section>`;
  layer.addEventListener('click', e => { if(e.target===layer)closeMobileSheet(); });
  document.body.append(layer);
}
function showCategories(bookId, editName) {
  const names=state.categories || ['Default','nsfw'];
  if(bookId) {
    const book=bookById(bookId);
    categoryLayer('Choose category', `<p>${esc(book.title)}</p><div class="category-choices">${names.map(name=>button('mobile-category-choose',`${bookCategory(book)===name?'✓ ':''}${esc(name)}`,'secondary',`data-id="${esc(bookId)}" data-category="${esc(name)}"`)).join('')}</div><p>Create groups using + beside the Library categories.</p>`);
    return;
  }
  categoryLayer(editName ? 'Rename category' : 'Categories', `${!editName ? `<div class="category-rows">${names.map(name=>`<div><b>${esc(name)}</b>${name==='Default'?'<small>Uncategorized manga</small>':`${button('mobile-edit-category','Rename','secondary',`data-name="${esc(name)}"`)}${button('mobile-category-delete','Delete','secondary',`data-name="${esc(name)}"`)}`}</div>`).join('')}</div>`:''}<form id="category-form"><label>${editName?'Category name':'New category'}<input id="category-name" maxlength="60" required value="${esc(editName || '')}" placeholder="e.g. Action, Romance, To read"></label><button class="primary" type="submit">${editName?'Save name':'Create category'}</button></form>`);
  document.querySelector('#category-form').addEventListener('submit',async event=>{
    event.preventDefault(); const submit=event.target.querySelector('button');submit.disabled=true;
    try { await changeCategory(editName?'rename':'create',editName || document.querySelector('#category-name').value,editName?document.querySelector('#category-name').value:undefined); }
    catch(error){document.querySelector('.category-error').textContent=String(error);submit.disabled=false;}
  });
}
function showCategoryDelete(name) {
  categoryLayer('Delete category?', `<p>Delete “${esc(name)}”? Its manga will move to Default. Your manga and reading progress are kept.</p>${button('mobile-category-confirm-delete','Delete category','primary',`data-name="${esc(name)}"`)}`);
}
async function changeCategory(action,name,replacement) {
  applySnapshot(await api('edit_category',{action,name,replacement:replacement || null}));
  if(action==='create')state.mobileCategory=name.trim();
  if(action==='rename')state.mobileCategory=replacement.trim();
  if(state.detail)state.detail=bookById(state.detail.id);
  render();if(state.detail)renderDetails();showCategories();
}
function mobileIcon(name) {
  if (name === 'more') return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>';
  if (name === 'menu') return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
  if (name === 'filter') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 11h10M10 16h4"/></svg>';
  return icon(name);
}
function renderMobileApp(data, updateCount) {
  document.body.classList.add('mobile-layout');
  state.mobileCategory ||= 'Default';
  const library = state.page === 'Library';
  const shown = library && navigator.onLine!==false ? data.filter(book => matchesLibraryCategory(book,state.mobileCategory)) : data;
  const pages = [['History','history'],['Updates','settings'],['Library','library'],['Browse','browse'],['Settings','more']];
  const title = state.page === 'Settings' ? 'More' : state.page;
  const search = state.mobileSearch || state.page === 'Browse';
  const header = `<header class="mobile-header"><h1>${title}</h1><div class="mobile-actions">${button('mobile-search',mobileIcon('search'),'mobile-icon','aria-label="Search manga"')}${button('mobile-filters',mobileIcon('filter'),'mobile-icon','aria-label="Filter and sort library"')}${button('mobile-menu',mobileIcon('menu'),'mobile-icon','aria-label="Library options"')}</div></header>`;
  const tabs = library ? (navigator.onLine===false?'':categoryTabs(true))+(navigator.onLine===false?'<p class="offline-library-note" role="status">Offline · Showing downloaded manga</p>':'') : '';
  const searchBar = search && state.page !== 'Settings' ? `<label class="search mobile-search">${icon('search')}<input id="search" aria-label="Search manga" placeholder="${state.page === 'Browse' ? 'Search source' : 'Search library'}" value="${esc(state.query)}"></label>` : '';
  const source = '';
  const empty = !shown.length && !state.loading ? `<div class="empty mobile-empty">${icon('book')}<h3>${allSourcesSkipped() ? 'All sources are skipped' : library ? 'No manga in this category' : 'No titles yet'}</h3><p>${allSourcesSkipped() ? 'Manage skipped sources or choose an individual source in Settings.' : state.query ? 'Try another search.' : library && state.mobileCategory === 'nsfw' ? 'Open a title and choose Move to nsfw.' : 'Browse a source or import your manga.'}</p>${allSourcesSkipped() ? button('source-settings','Manage sources','primary') : !library && state.page==='Browse' && !state.source ? button('nav','Add sources in Settings','primary','data-page="Settings"') : button(library ? 'browse' : 'import',library ? 'Browse manga' : 'Import files','primary')}</div>` : '';
  const content = state.page === 'Settings' ? `<div class="mobile-settings-shortcuts">${button('import','Import manga files')}${button('nav','Downloads','secondary','data-page="Downloads"')}</div>${settingsView()}` : `${tabs}${searchBar}${source}${state.error ? `<div class="error-box" role="alert">${esc(state.error)} ${button(state.page==='Browse'?'refresh-source':'reload','Retry')}</div>` : ''}<div class="grid mobile-grid ${state.list ? 'list' : ''}">${shown.map(card).join('')}${state.loading ? '<div class="empty"><span class="spinner"></span> Loading manga…</div>' : empty}</div>${state.page === 'Browse' && state.catalog.length < state.total && !state.loading ? `<div class="load-more">${button('load-more','Load more')}</div>` : ''}`;
  document.querySelector('#app').innerHTML = `<div class="mobile-shell">${header}<main class="mobile-main">${content}</main><nav class="mobile-bottom" aria-label="Main navigation">${pages.map(([page, glyph]) => `<button data-action="nav" data-page="${page}" class="${state.page === page || page === 'Settings' && state.page === 'Downloads' ? 'active' : ''}" ${state.page === page ? 'aria-current="page"' : ''}><span class="mobile-nav-icon">${mobileIcon(glyph)}${page === 'Updates' && updateCount ? `<small>${updateCount > 99 ? '99+' : updateCount}</small>` : ''}</span><span>${page === 'Settings' ? 'More' : page}</span></button>`).join('')}</nav></div>`;
}
function closeMobileSheet() { document.querySelector('#mobile-sheet')?.remove(); }
function showMobileSheet(kind) {
  closeMobileSheet();
  const layer = document.createElement('div');
  layer.id = 'mobile-sheet';
  layer.className = 'modal-backdrop mobile-sheet-backdrop';
  const filters = `<h2>Filter and sort</h2><div class="mobile-filter-options">${['All','Reading','Completed','Favorites','Local'].map(tab => button('mobile-filter',tab, state.tab === tab ? 'primary' : 'secondary',`data-tab="${tab}"`)).join('')}</div><label class="mobile-sort-label">Sort titles<select id="sort">${['Recent','Title A–Z','Unread chapters','Recently read'].map(sort => `<option ${state.sort === sort ? 'selected' : ''}>${sort}</option>`).join('')}</select></label>`;
  const menu = `<h2>Library options</h2>${button('import','Import files')}${button('nav','Downloads','secondary','data-page="Downloads"')}${button('refresh-library','Update library')}${button('nav','Settings','secondary','data-page="Settings"')}`;
  layer.innerHTML = `<section class="modal mobile-sheet" role="dialog" aria-modal="true" aria-label="${kind === 'filters' ? 'Filter and sort' : 'Library options'}"><span class="sheet-handle"></span>${kind === 'filters' ? filters : menu}${button('mobile-close-sheet','Close','secondary')}</section>`;
  layer.addEventListener('click',event => {
    if (event.target === layer) closeMobileSheet();
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action && !action.startsWith('mobile-')) closeMobileSheet();
  });
  document.body.append(layer);
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  const action = target?.dataset.action;
  if(action==='manga-download-info'){const b=bookById(target.dataset.id),count=b.chapters.filter(c=>c.downloaded).length;categoryLayer('Downloaded chapters',`<p>${esc(b.title)}</p><p><b>${count} of ${b.chapters.length} chapters</b> saved on this device.</p>`);return;}
  if (!action?.startsWith('mobile-')) return;
  event.stopImmediatePropagation();
  try {
    if (action === 'mobile-category') await animateMobileCategory(target.dataset.category);
    if (action === 'mobile-manage-categories') showCategories();
    if (action === 'mobile-assign-category') showCategories(target.dataset.id);
    if (action === 'mobile-edit-category') showCategories(null, target.dataset.name);
    if (action === 'mobile-category-delete') showCategoryDelete(target.dataset.name);
    if (action === 'mobile-category-confirm-delete') await changeCategory('delete', target.dataset.name);
    if (action === 'mobile-category-choose') {
      applySnapshot(await api('set_book_category', {bookId:target.dataset.id,category:target.dataset.category}));
      state.detail=bookById(target.dataset.id); closeMobileSheet(); render(); renderDetails();
    }
    if (action === 'mobile-search') { state.mobileSearch = !state.mobileSearch; if (!state.mobileSearch) state.query = ''; render(); document.querySelector('#search')?.focus(); }
    if (action === 'mobile-filters') showMobileSheet('filters');
    if (action === 'mobile-menu') showMobileSheet('menu');
    if (action === 'mobile-close-sheet') closeMobileSheet();
    if (action === 'mobile-filter') { state.tab = target.dataset.tab; closeMobileSheet(); render(); }
    if (action === 'mobile-move-category') {
      const book = bookById(target.dataset.id);
      const category = bookCategory(book) === 'nsfw' ? 'Default' : 'nsfw';
      applySnapshot(await api('set_book_category', { bookId: book.id, category }));
      state.detail = bookById(book.id);
      render(); renderDetails(); toast(`Moved to ${category}`);
    }
  } catch (error) { toast(error); }
});

document.addEventListener('change',event=>{if(event.target.id==='chapter-order'){try{localStorage.setItem('mreader:chapter-order',event.target.value);}catch{}renderDetails();}});
let mobileGesture=null,categorySlide=null;
function reducedCategoryMotion(){return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;}
function clearCategorySlide(){
 const slide=categorySlide;if(!slide)return;categorySlide=null;
 for(const animation of slide.animations||[])animation.cancel();
 slide.current.style.removeProperty('transform');slide.current.style.removeProperty('will-change');slide.current.style.removeProperty('pointer-events');
 if(slide.wrapper.isConnected)slide.wrapper.replaceWith(slide.current);
}
function prepareCategorySlide(target,sign){
 clearCategorySlide();
 const current=document.querySelector('.mobile-main>.mobile-grid');if(!current)return null;
 const rect=current.getBoundingClientRect(),wrapper=document.createElement('div');wrapper.className='category-swipe-viewport';wrapper.style.height=Math.max(rect.height,180)+'px';
 current.before(wrapper);wrapper.append(current);current.style.willChange='transform';current.style.pointerEvents='none';
 const preview=document.createElement('div');preview.className='grid mobile-grid category-swipe-preview';preview.inert=true;preview.setAttribute('aria-hidden','true');
 const data=target?filtered().filter(book=>matchesLibraryCategory(book,target)):[];
 preview.innerHTML=data.length?data.map(card).join(''):'<div class="empty mobile-empty"><h3>No manga in this category</h3></div>';
 preview.style.top=(window.scrollY||0)+'px';wrapper.append(preview);
 const width=wrapper.clientWidth;preview.style.transform=`translate3d(${sign*width}px,0,0)`;
 categorySlide={current,preview,wrapper,width,target,sign,category:state.mobileCategory,dx:0,animations:[]};return categorySlide;
}
function dragCategory(dx){
 const names=libraryCategoryNames(),index=names.indexOf(state.mobileCategory),sign=dx<0?1:-1,target=names[index+sign];
 let slide=categorySlide;if(!slide||slide.sign!==sign)slide=prepareCategorySlide(target,sign);if(!slide)return;
 slide.dx=target?Math.max(-slide.width,Math.min(slide.width,dx)):dx*.22;
 slide.current.style.transform=`translate3d(${slide.dx}px,0,0)`;
 slide.preview.style.transform=`translate3d(${sign*slide.width+slide.dx}px,0,0)`;
}
async function settleCategorySlide(commit){
 const slide=categorySlide;if(!slide)return;
 const destination=commit&&slide.target?-slide.sign*slide.width:0;
 const duration=reducedCategoryMotion()?0:210;
 for(const [element,to] of [[slide.current,destination],[slide.preview,slide.sign*slide.width+destination]]){
  const animation=element.animate([{transform:element.style.transform},{transform:`translate3d(${to}px,0,0)`}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
  slide.animations.push(animation);
 }
 await Promise.allSettled(slide.animations.map(a=>a.finished));
 if(categorySlide!==slide)return;
 const valid=state.page==='Library'&&state.mobileCategory===slide.category&&slide.wrapper.isConnected;
 clearCategorySlide();
 if(commit&&slide.target&&valid){state.mobileCategory=slide.target;render();window.scrollTo?.(0,0);document.querySelector('.mobile-categories .active')?.scrollIntoView({behavior:reducedCategoryMotion()?'instant':'smooth',block:'nearest',inline:'nearest'});}
}
async function animateMobileCategory(name){
 if(name===state.mobileCategory){clearCategorySlide();return;}
 if(!useMobileLayout()||navigator.onLine===false){clearCategorySlide();state.mobileCategory=name;render();return;}
 const names=libraryCategoryNames(),sign=names.indexOf(name)>names.indexOf(state.mobileCategory)?1:-1;
 prepareCategorySlide(name,sign);await settleCategorySlide(true);
}
document.addEventListener('touchstart',event=>{
 if(event.touches.length!==1){mobileGesture=null;void settleCategorySlide(false);return;}
 if(!useMobileLayout()||state.reader||state.detail||document.querySelector('#mobile-sheet'))return;
 clearCategorySlide();const t=event.touches[0];const blocked=event.target.closest('input,select,textarea,.mobile-bottom,.mobile-categories');
 mobileGesture=blocked?null:{x:t.clientX,y:t.clientY,page:state.page,top:window.scrollY<=2,time:performance.now(),axis:null};
},{passive:true});
document.addEventListener('touchmove',event=>{
 const start=mobileGesture;if(!start||event.touches.length!==1||state.page!==start.page||state.page!=='Library'||navigator.onLine===false)return;
 const t=event.touches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;
 if(!start.axis&&Math.max(Math.abs(dx),Math.abs(dy))>10)start.axis=Math.abs(dx)>Math.abs(dy)*1.3?'horizontal':'vertical';
 if(start.axis!=='horizontal')return;
 if(event.cancelable)event.preventDefault();dragCategory(dx);
},{passive:false});
document.addEventListener('touchend',event=>{
 const start=mobileGesture;mobileGesture=null;if(!start||state.page!==start.page||!event.changedTouches.length){void settleCategorySlide(false);return;}
 const t=event.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;
 if(state.page==='Library'&&navigator.onLine!==false&&start.axis!=='vertical'&&Math.abs(dx)>Math.abs(dy)*1.5){
  if(!categorySlide&&Math.abs(dx)>10)dragCategory(dx);
  const threshold=Math.min(80,Math.max(45,(categorySlide?.width||innerWidth)*.2));
  const flick=Math.abs(dx)>25&&Math.abs(dx)/Math.max(1,performance.now()-start.time)>.5;
  void settleCategorySlide(Math.abs(dx)>threshold||flick);return;
 }
 void settleCategorySlide(false);
 if(state.page==='Browse'&&start.top&&dy>90&&dy>Math.abs(dx)*1.5&&!state.loading){toast('Refreshing sources…');searchSource(false,true).catch(toast);}
},{passive:true});
document.addEventListener('touchcancel',()=>{mobileGesture=null;void settleCategorySlide(false);},{passive:true});
document.addEventListener('click',event=>{if(categorySlide&&event.target.closest('.category-swipe-viewport')){event.preventDefault();event.stopImmediatePropagation();}},true);
window.addEventListener('offline',()=>{if(state.page==='Library'&&!state.reader)render();});
window.addEventListener('online',()=>{if(state.page==='Library'&&!state.reader)render();});
