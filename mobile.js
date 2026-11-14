// Android and Linux WebViews need a bundled PDF viewer. Render one page at a time
// so large books don't allocate a canvas for every page.
function isAndroid() {
  return /Android/i.test(globalThis.navigator?.userAgent || "");
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
function bookCategory(book) {
  return book.tags?.includes('mreader:category:nsfw') ? 'nsfw' : 'Default';
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
  const shown = library ? data.filter(book => bookCategory(book) === state.mobileCategory) : data;
  const pages = [['Library','library'],['Updates','settings'],['History','history'],['Browse','browse'],['Settings','more']];
  const title = state.page === 'Settings' ? 'More' : state.page;
  const search = state.mobileSearch || state.page === 'Browse';
  const header = `<header class="mobile-header"><h1>${title}</h1><div class="mobile-actions">${button('mobile-search',mobileIcon('search'),'mobile-icon','aria-label="Search manga"')}${button('mobile-filters',mobileIcon('filter'),'mobile-icon','aria-label="Filter and sort library"')}${button('mobile-menu',mobileIcon('menu'),'mobile-icon','aria-label="Library options"')}</div></header>`;
  const tabs = library ? `<nav class="mobile-categories" aria-label="Library categories">${['Default','nsfw'].map(category => `<button data-action="mobile-category" data-category="${category}" class="${state.mobileCategory === category ? 'active' : ''}" ${state.mobileCategory === category ? 'aria-current="page"' : ''}>${category}</button>`).join('')}</nav>` : '';
  const searchBar = search && state.page !== 'Settings' ? `<label class="search mobile-search">${icon('search')}<input id="search" aria-label="Search manga" placeholder="${state.page === 'Browse' ? 'Search source' : 'Search library'}" value="${esc(state.query)}"></label>` : '';
  const source = state.page === 'Browse' ? `<div class="mobile-source"><label>Source <select id="source"><option value="mangadex" ${state.source === 'mangadex' ? 'selected' : ''}>MangaDex</option><option value="komga" ${state.source === 'komga' ? 'selected' : ''}>Komga</option>${typeof extensionOptions === 'function' ? extensionOptions() : ''}</select></label></div>` : '';
  const empty = !shown.length && !state.loading ? `<div class="empty mobile-empty">${icon('book')}<h3>${library ? 'No manga in this category' : 'No titles yet'}</h3><p>${state.query ? 'Try another search.' : library && state.mobileCategory === 'nsfw' ? 'Open a title and choose Move to nsfw.' : 'Browse a source or import your manga.'}</p>${button(library ? 'browse' : 'import',library ? 'Browse manga' : 'Import files','primary')}</div>` : '';
  const content = state.page === 'Settings' ? `<div class="mobile-settings-shortcuts">${button('import','Import manga files')}${button('nav','Downloads','secondary','data-page="Downloads"')}</div>${settingsView()}` : `${tabs}${searchBar}${source}${state.error ? `<div class="error-box" role="alert">${esc(state.error)} ${button('reload','Retry')}</div>` : ''}<div class="grid mobile-grid ${state.list ? 'list' : ''}">${shown.map(card).join('')}${state.loading ? '<div class="empty"><span class="spinner"></span> Loading manga…</div>' : empty}</div>${state.page === 'Browse' && state.catalog.length < state.total && !state.loading ? `<div class="load-more">${button('load-more','Load more')}</div>` : ''}`;
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
  if (!action?.startsWith('mobile-')) return;
  event.stopImmediatePropagation();
  try {
    if (action === 'mobile-category') { state.mobileCategory = target.dataset.category; render(); }
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
