"use strict";
const icons = {
  library: '<path d="M4 4h5v16H4zM12 4h4v16h-4zM18 5l3 14"/>',
  updates:
    '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  history: '<path d="M3 5v5h5M4 10a8 8 0 1 1 1 8M12 7v5l3 2"/>',
  browse: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',
  downloads: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  grid: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  book: '<path d="M12 5c-4-3-9-2-9-2v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2v16"/>',
  heart:
    '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-4 4 1 9 8 15 7-6 12-11 8-15"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.book}</svg>`;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const native = !!window.__TAURI__;
const nativeInvoke = (name, args = {}) =>
  native
    ? window.__TAURI__.core.invoke(name, args)
    : Promise.reject(
        Error("Open the Rust desktop app to use this feature. Run npm start."),
      );
async function api(name, args = {}) {
  if (name === "cloud_sync" && typeof flushStripProgress === "function") await flushStripProgress();
  const result = await nativeInvoke(name, args);
  if (
    [
      "save_progress",
      "add_book",
      "remove_book",
      "favorite",
      "set_book_category",
      "edit_category",
      "import_paths",
      "import_files",
      "chapters",
      "apk_install",
      "apk_remove",
      "source_prefer",
      "extension_install",
      "extension_remove",
    ].includes(name) &&
    typeof queueAccountSync === "function"
  )
    queueAccountSync();
  if(name === "save_progress" && typeof inferEarlierRead === "function") inferEarlierRead(args.bookId,args.chapterId);
  return result;
}
const state = {
  books: [],
  progress: [],
  settings: {
    theme: "dark",
    language: "en",
    direction: "ltr",
    fit: "width",
    readerLayout: "paged",
    dataSaver: false,
    komgaUrl: "",
    komgaUser: "",
  },
  page: "Library",
  tab: "All",
  query: "",
  source: "",
  catalog: [],
  total: 0,
  apkPage: 0,
  sort: "Recent",
  list: false,
  loading: false,
  error: "",
  dataDir: "",
  detail: null,
  detailLoading: false,
  detailError: "",
  reader: null,
  downloads: new Map(),
  busy: false,
};
const coverCache = new Map(),
  coverGeneration = new Map(),
  coverPending = new Set(),
  coverFailed = new Set(),
  pageCache = new Map(),
  pagePending = new Map();
let searchTimer,
  searchVersion = 0,
  readerVersion = 0,
  toastTimer;
const navigationHistory = [];
let lastRootBack = 0;
const button = (action, label, cls = "secondary", attrs = "") =>
  `<button class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = String(message);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}
function applySnapshot(s) {
  const previousBooks=new Map(state.books.map(b=>[b.id,b]));
  for(const next of s.books){
    const old=previousBooks.get(next.id);
    if(old?.customCover?.updatedAt!==next.customCover?.updatedAt||old?.customCover?.jpeg!==next.customCover?.jpeg){
      coverGeneration.set(next.id,(coverGeneration.get(next.id)||0)+1);
      const image=coverCache.get(next.id);if(image)URL.revokeObjectURL(image);coverCache.delete(next.id);coverFailed.delete(next.id);
    }
  }
  state.books = s.books;
  state.categories = s.categories || ["Default", "nsfw"];
  if (![...state.categories,"Favorites"].includes(state.mobileCategory)) state.mobileCategory = "Default";
  state.progress = s.progress;
  indexProgress();
  state.settings = s.settings;
  state.dataDir = s.dataDir;
  document.body.classList.toggle("light", s.settings.theme === "light");
}
const bookById = (id) =>
  state.books.find((b) => b.id === id) ||
  state.catalog.find((b) => b.id === id);
const progressIndex = new Map(),
  latestIndex = new Map();
function indexProgress() {
  progressIndex.clear();
  latestIndex.clear();
  for (const p of state.progress) {
    progressIndex.set(`${p.bookId}\0${p.chapterId}`, p);
    if (
      !latestIndex.has(p.bookId) ||
      p.updated > latestIndex.get(p.bookId).updated
    )
      latestIndex.set(p.bookId, p);
  }
}
const progressFor = (book, chapter) => progressIndex.get(`${book}\0${chapter}`);
const unread = (b) =>
  b.chapters.filter((c) => !progressFor(b.id, c.id)?.completed).length;
const latest = (b) => latestIndex.get(b.id);
function cover(b, cls = "cover-art") {
  const src = coverCache.get(b.id) || "";
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="${esc(b.title)} cover" loading="lazy" decoding="async">`
    : `<div class="${cls} cover-placeholder" data-cover="${esc(b.id)}">${icon("book")}<span>${esc(b.title)}</span>${typeof mangaExtensionInfo==="function"&&!mangaExtensionInfo(b).installed?'<small>Extension needed for cover art</small>':""}</div>`;
}
function card(b) {
  const saved = state.books.some((x) => x.id === b.id),
    count = unread(b),
    dl = b.chapters.filter((c) => c.downloaded).length;
  return `<article class="card" tabindex="0" role="button" data-action="details" data-id="${esc(b.id)}" aria-label="Open ${esc(b.title)}"><div class="cover">${cover(b)}<div class="badges">${count ? `<span class="badge">${count}</span>` : ""}${dl ? `<span class="badge download">↓ ${dl}</span>` : ""}${saved && state.page === "Browse" ? '<span class="badge download">In library</span>' : ""}</div>${b.tags.some(t=>t.startsWith("mreader:update:")) ? '<span class="new-chapters">New</span>' : ""}${b.favorite ? '<span class="cover-favorite">♥</span>' : ""}</div><h3>${esc(b.title)}</h3><p><i class="status-dot"></i>${esc(b.status || "Unknown")}<span class="source-tag">${typeof sourceLabel === "function" ? esc(sourceLabel(b.source)) : esc(b.source)}${typeof browseVariants!=="undefined" && browseVariants.get(b.id)?.length>1?" · "+browseVariants.get(b.id).length+" sources":""}</span></p></article>`;
}
function filtered() {
  let data =
    state.page === "Browse"
      ? state.catalog.map((b) => state.books.find((x) => x.id === b.id) || b)
      : [...state.books];
  if (state.page === "Library" && typeof useMobileLayout === "function" && !useMobileLayout() && state.mobileCategory) data = data.filter(b => matchesLibraryCategory(b,state.mobileCategory));
  if(state.page==="Library" && globalThis.navigator?.onLine===false)data=data.filter(b=>(b.source==="local"&&b.path)||b.chapters.some(c=>c.downloaded&&c.path));
  if (state.page === "History") data = data.filter((b) => latest(b));
  if (state.page === "Downloads")
    data = data.filter((b) => b.chapters.some((c) => c.downloaded));
  if (state.page === "Updates")
    data = data.filter((b) => b.source !== "local" && unread(b) > 0);
  if (state.tab === "Favorites") data = data.filter((b) => b.favorite);
  if (state.tab === "Reading")
    data = data.filter((b) => latest(b) && unread(b) > 0);
  if (state.tab === "Completed")
    data = data.filter((b) => b.chapters.length && unread(b) === 0);
  if (state.tab === "Local") data = data.filter((b) => b.source === "local");
  if (state.page !== "Browse" && state.query)
    data = data.filter((b) =>
      (b.title + " " + b.author + " " + b.tags.join(" "))
        .toLowerCase()
        .includes(state.query.toLowerCase()),
    );
  if (state.sort === "Title A–Z")
    data.sort((a, b) => a.title.localeCompare(b.title));
  if (state.sort === "Unread chapters")
    data.sort((a, b) => unread(b) - unread(a));
  if (state.page === "History" || state.sort === "Recently read")
    data.sort((a, b) => (latest(b)?.updated || 0) - (latest(a)?.updated || 0));
  return data;
}
function continueReadingItems(limit = 12) {
  const books = new Map(state.books.map(book => [book.id, book]));
  const seen = new Set(), items = [];
  for (const progress of [...state.progress].sort((a,b) => b.updated-a.updated)) {
    const book = books.get(progress.bookId);
    if (!book || seen.has(book.id)) continue;
    const index = book.chapters.findIndex(chapter => chapter.id === progress.chapterId);
    if (index < 0) continue;
    seen.add(book.id);
    if (typeof bookCategory === 'function' && state.mobileCategory && bookCategory(book) !== state.mobileCategory) continue;
    let chapter = book.chapters[index], saved = progress;
    const finished = progress.completed && (!chapter.pages || progress.page >= chapter.pages-1);
    if (finished) {
      chapter = book.chapters.slice(index+1).find(next => !progressFor(book.id,next.id)?.completed);
      if (!chapter) continue;
      saved = progressFor(book.id,chapter.id);
    }
    const page = Math.max(0,Math.min(saved?.page || 0,chapter.pages ? chapter.pages-1 : Number.MAX_SAFE_INTEGER));
    items.push({book,chapter,page,next:finished});
    if (items.length >= limit) break;
  }
  return items;
}
function continueReadingView() {
  const items = continueReadingItems();
  return `<section class="continue-reading" aria-labelledby="continue-reading-title"><div class="continue-heading"><div><h2 id="continue-reading-title">Continue reading</h2><p>Pick up your recently read manga.</p></div>${button('nav','View history','secondary','data-page="History"')}</div>${items.length ? `<div class="continue-grid">${items.map(({book,chapter,page,next})=>`<article class="continue-card">${cover(book,'continue-cover')}<div class="continue-copy"><h3>${esc(book.title)}</h3><p>${next?'Next: ':''}Chapter ${esc(chapter.number)} · Page ${page+1}${chapter.pages?' of '+chapter.pages:''}</p><div class="progress-track" aria-hidden="true"><i style="width:${chapter.pages?Math.min(100,(page+1)/chapter.pages*100):0}%"></i></div>${button('read',icon('book')+' Continue '+icon('arrow'),'primary',`data-id="${esc(book.id)}" data-chapter="${esc(chapter.id)}" aria-label="Continue reading ${esc(book.title)}"`)}</div></article>`).join('')}</div>` : '<p class="continue-empty">Your recently read manga will appear here when you start reading.</p>'}</section>`;
}

function render() {
  const searchFocus =
    document.activeElement?.id === "search"
      ? document.activeElement.selectionStart
      : null;
  const data = filtered(),
    count = state.books.reduce(
      (n, b) => n + (b.source !== "local" ? unread(b) : 0),
      0,
    );
  document.body.classList.toggle("light", state.settings.theme === "light");
  if (typeof useMobileLayout === "function" && useMobileLayout()) {
    renderMobileApp(data, count);
    updateDownloadProgress();
    loadCovers();
    if (searchFocus !== null) {
      const input = document.querySelector("#search");
      input?.focus();
      input?.setSelectionRange(searchFocus, searchFocus);
    }
    return;
  }
  document.body.classList.toggle("mobile-layout", false);
  document.querySelector("#app").innerHTML =
    `<div class="shell ${state.settings.sidebarCollapsed ? "sidebar-collapsed" : ""}"><aside class="sidebar" aria-label="Sidebar"><button class="sidebar-toggle" data-action="toggle-sidebar" aria-label="${state.settings.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}" aria-expanded="${!state.settings.sidebarCollapsed}">☰</button><div class="brand">${icon("book")}<span>mreader<small>YOUR NEXT CHAPTER</small></span></div><nav class="nav">${["Library", "Updates", "History", "Browse", "Downloads"].map((p) => `<button data-action="nav" data-page="${p}" class="${state.page === p ? "active" : ""}" title="${p}" aria-label="${p}">${icon(p.toLowerCase())}<span>${p}</span>${p === "Updates" && count ? `<span class="count">${count}</span>` : ""}</button>`).join("")}</nav><nav class="nav sidebar-import"><button data-action="import" title="Import files" aria-label="Import files">${icon("plus")}<span>Import files</span></button></nav><div class="side-label">YOUR COLLECTIONS</div>${["Favorites", "Reading", "Completed", "Local"].map((c, i) => `<button class="collection" data-action="collection" data-tab="${c}" title="${c}" aria-label="${c}"><i class="dot" style="background:${["#c7b2ec", "#8aaf9c", "#c6a87d", "#88a5c7"][i]}"></i><span>${c}</span></button>`).join("")}<div class="side-bottom"><nav class="nav"><button data-action="nav" data-page="Settings" title="Settings" aria-label="Settings" class="${state.page === "Settings" ? "active" : ""}">${icon("settings")}<span>Settings</span></button></nav><div class="sidebar-account" title="${native && typeof featureState !== "undefined" && featureState.cloud.signedIn ? "Signed in" : "Local library"}"><i class="status-dot"></i><span>${native && typeof featureState !== "undefined" && featureState.cloud.signedIn ? "Signed in" : "Local library"}</span></div><div class="storage"><b>Your stories. Your space.</b>${state.books.length} titles · ${state.books.filter((b) => b.source === "local").length} local<div class="storage-bar"><i></i></div>Read your way</div></div></aside><main class="main"><header class="topbar"></header>${state.page === "Settings" ? settingsView() : `<div class="heading"><div><div class="eyebrow">YOUR PERSONAL MANGA SPACE</div><h1>${state.page === "Library" ? "My library" : state.page === "Browse" ? "Discover your next story" : state.page}</h1><p class="sub">${{ Library: "All your stories. Right where you left them.", Browse: "Browse and search your installed manga sources.", History: "Every story you’ve spent a little time with.", Downloads: "Chapters saved on this computer, ready to read offline.", Updates: "Unread chapters from your online collection." }[state.page]}</p></div><div class="button-row">${["Browse","Updates"].includes(state.page) ? button(state.page === "Browse" ? "refresh-source" : "refresh-library", icon(state.page === "Updates" ? "updates" : "browse") + (state.page === "Browse" ? " Refresh" : " Check updates"), "primary") : ""}</div></div>${state.page === "Library" ? (typeof categoryTabs === "function" ? categoryTabs() : "") : ""}<div class="tabs-row">${["All", "Reading", "Completed", "Favorites", "Local"].map((t) => `<button class="tab ${state.tab === t ? "active" : ""}" data-action="tab" data-tab="${t}">${t}${t === "All" ? `<span>${state.page === "Browse" ? state.catalog.length : state.books.length}</span>` : ""}</button>`).join("")}</div><div class="tools"><label class="search">${icon("search")}<input id="search" aria-label="Search manga" placeholder="${state.page === "Browse" ? "Search source…" : "Search your library…"}" value="${esc(state.query)}"></label><div class="toolbar-right"><span class="result-count">${data.length} titles</span><select id="sort" aria-label="Sort titles">${["Recent", "Title A–Z", "Unread chapters", "Recently read"].map((s) => `<option ${state.sort === s ? "selected" : ""}>${s}</option>`).join("")}</select><div class="view-switch">${button("grid", icon("grid"), !state.list ? "active" : "", 'aria-label="Grid view"')}${button("list", icon("list"), state.list ? "active" : "", 'aria-label="List view"')}</div></div></div>${state.error ? `<div class="error-box" role="alert">${esc(state.error)} ${button(state.page === "Browse" ? "refresh-source" : "reload", "Retry")}</div>` : ""}<div class="grid ${state.list ? "list" : ""}">${data.map(card).join("")}${state.loading ? '<div class="empty"><span class="spinner"></span> Connecting to source…</div>' : !data.length ? `<div class="empty">${icon("book")}<h3>${allSourcesSkipped() ? "All sources are skipped" : state.page === "Library" ? "Your library is a blank page." : "No titles here yet."}</h3><p>${allSourcesSkipped() ? "Manage skipped sources or choose an individual source in Settings." : state.query ? "Try another search." : state.page === "Browse" ? "Add your own extension in Settings, then choose its source and search for a title." : "Browse manga or import CBZ, CBR, PDF, and image folders."}</p>${allSourcesSkipped() ? button("source-settings", "Manage sources", "primary") : state.page === "Browse" && !state.source ? button("nav", "Add sources in Settings", "primary", 'data-page="Settings"') : button("browse", "Discover manga", "primary")} ${button("import-folder", "Import folder")}</div>` : ""}</div>${state.page === "Browse" && state.catalog.length < state.total && !state.loading ? `<div class="load-more">${button("load-more", "Load more titles")}</div>` : ""}${state.page === "Library" ? continueReadingView() : ""}<footer class="footer"><span>${state.page === "Browse" ? "Connected to " + (typeof sourceLabel === "function" ? esc(sourceLabel(state.source)) : state.source) : state.books.length + " stories. Countless worlds to get lost in."}</span><span>Your library, across your devices</span></footer>`}</main></div>`;
  arrangeDesktopHeader();
  updateDownloadProgress();
  loadCovers();
  if (searchFocus !== null) {
    const input = document.querySelector("#search");
    input?.focus();
    input?.setSelectionRange(searchFocus, searchFocus);
  }
}
function arrangeDesktopHeader() {
  const header=document.querySelector('.main .topbar'), search=document.querySelector('.main .tools .search');
  if(header && search) header.append(search);
  const tabs=document.querySelector('.main>.tabs-row'),tools=document.querySelector('.main>.tools'),right=tools?.querySelector('.toolbar-right');
  if(tabs&&right){tabs.append(right);tools.remove();}
  const heading=document.querySelector('.main>.heading'),categories=document.querySelector('.main>.category-tabs');
  if(heading){heading.classList.add('compact-heading');if(categories){heading.classList.add('library-heading');heading.append(categories);}}
}
async function navigate(page, remember = true) {
  if(remember && state.page!==page){navigationHistory.push({page:state.page,tab:state.tab,query:state.query,mobileSearch:state.mobileSearch});if(navigationHistory.length>20)navigationHistory.shift();}
  if(state.page==="Browse")saveBrowseView();
  lastRootBack=0;
  searchVersion++;
  clearTimeout(searchTimer);
  state.page = page;
  state.tab = "All";
  state.query = "";
  state.error = "";
  state.loading = false;
  render();
  if (page === "Browse" && !restoreBrowseView()) await searchSource();
}
async function reload() {
  applySnapshot(await api("snapshot"));
  render();
}
async function searchSource(more = false, force = false, retrySources = null) {
  if (typeof ensureUserSource === "function") ensureUserSource();
  if (!state.source) { browseFailures.clear();state.catalog=[];state.total=0;state.loading=false;state.error="";render();return; }
  const version = ++searchVersion;
  if(state.source==='all')state.catalog=mergeBrowseBooks(state.catalog.flatMap(b=>browseVariants.get(b.id)||[b]).filter(b=>!sourceIsSkipped(b.source)));
  if(!more&&!retrySources)browseFailures.clear();
  state.loading = true;
  state.error = "";
  const catalogContext=JSON.stringify([state.source,state.query,browseScope()]);
  if (!more && state.catalogContext!==catalogContext) state.catalog = [];
  state.catalogContext=catalogContext;
  const q = state.query,
    start = more ? state.catalog.length : 0;
  render();
  try {
    if(state.source === "all") { await searchAllSources(more,version,force,retrySources); return; }
    const result = await cachedSourceSearch(state.source,q,state.source.startsWith("apk:") ? (more ? state.apkPage + 1 : 1) : start,force||sourceIsSkipped(state.source));
    if (version !== searchVersion || state.page !== "Browse") return;
    clearSourceSkip(state.source);browseFailures.delete(state.source);
    state.catalog = more ? [...state.catalog, ...result.books] : result.books;
    if (state.source.startsWith("apk:")) {
      state.apkPage = more ? state.apkPage + 1 : 1;
      state.total = state.catalog.length + (result.total > result.books.length ? 1 : 0);
    } else state.total = result.total;
  } catch (e) {
    if (version === searchVersion && state.page === "Browse") {recordBrowseFailure({id:state.source,name:sourceLabel(state.source)},e);state.error="";}
  } finally {
    if (version === searchVersion) {
      state.loading = false;
      render();
    }
  }
}
async function importFiles(folder = false, paths = null) {
  if(/Android/i.test(globalThis.navigator?.userAgent||'')&&!paths){if(folder){toast('Choose CBZ or ZIP files on Android. Folder import is available on desktop.');return}const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.accept='.cbz,.zip,.pdf';picker.onchange=async()=>{try{for(const file of picker.files){if(file.size>256*1024*1024)throw Error('File exceeds 256 MiB');const result=await window.__TAURI__.core.invoke('import_bytes',await file.arrayBuffer(),{headers:{'x-mreader-filename':encodeURIComponent(file.name)}});applySnapshot(result.snapshot);}render();queueAccountSync();toast('Manga imported')}catch(e){toast(e)}};picker.click();return;}
  if (state.busy) return;
  state.busy = true;
  toast("Choose your manga files or folder…");
  try {
    const r = await api(
      paths ? "import_paths" : "import_files",
      paths ? { paths } : { folder },
    );
    applySnapshot(r.snapshot);
    state.page = "Library";
    state.tab = "All";
    state.query = "";
    render();
    toast(
      r.errors.length
        ? `${r.imported} imported. ${r.errors.join(" · ")}`
        : r.imported
          ? `${r.imported} title${r.imported === 1 ? "" : "s"} imported`
          : "Import cancelled",
    );
  } finally {
    state.busy = false;
  }
}
async function showDetails(id, refresh = false) {
  let b = bookById(id);
  if (!b) return;
  state.detail = b;
  state.detailLoading = false;
  state.detailError = "";
  renderDetails();
  if(!state.books.some(x=>x.id===id) && browseVariants.get(id)?.length>1){
    state.detailLoading=true;renderDetails();
    const primary=await compareBrowseSources(id);
    if(state.detail?.id!==id)return;
    state.detail=primary||b;state.detailLoading=false;renderDetails();return;
  }
  if (state.books.some((x) => x.id === id) && (refresh || !b.chapters.length)) {
    state.detailLoading = true;
    renderDetails();
    try {
      b = await api("chapters", { bookId: id, refresh });
      state.books = state.books.map((x) => (x.id === id ? b : x));
      if (state.detail?.id === id) state.detail = b;
    } catch (e) {
      if (state.detail?.id === id) state.detailError = String(e);
      toast(e);
    } finally {
      state.detailLoading = false;
      if (state.detail?.id === id) renderDetails();
    }
  }
}
function renderDetails() {
  document.querySelector("#detail")?.remove();
  const b = state.detail;
  if (!b) return;
  const mobile=typeof useMobileLayout==="function"&&useMobileLayout();
  const saved = state.books.some((x) => x.id === b.id),
    layer = document.createElement("div");
  layer.id = "detail";
  layer.className = "modal-backdrop manga-detail-backdrop";
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${esc(b.title)}">${button("close-detail", icon("close"), "icon-button close", 'aria-label="Close details"')}<div class="detail-top"><div class="detail-cover"><div class="cover" ${saved?`data-action="choose-custom-cover" data-id="${esc(b.id)}" role="button" tabindex="0" aria-label="Change cover art for ${esc(b.title)}"`:""}>${cover(b)}</div>${!mobile?mangaSourceView(b):""}</div><div class="detail-copy">${mobile?`<div class="detail-source-row">${mangaSourceView(b)}${mangaDownloadBadge(b)}</div>`:""}<div class="eyebrow">${esc(b.status || "Unknown status")}</div><h2>${esc(b.title)}</h2><p class="sub">${esc(b.author)}</p><div class="tags">${b.tags
    .filter(tag => !tag.startsWith("mreader:"))
    .slice(0, 4)
    .map((t) => `<span>${esc(t)}</span>`)
    .join(
      "",
    )}</div><p class="description">${esc(b.description || "No description available.")}</p><div class="button-row">${button(saved ? "remove" : "add", icon(saved ? "library" : "plus") + (saved ? " Remove from library" : " Add to library"), "primary", `data-id="${esc(b.id)}"`)}${saved ? button("favorite", icon("heart"), `secondary ${b.favorite ? "favorited" : ""}`, `data-id="${esc(b.id)}" aria-label="Toggle favorite"`) : ""}${saved && b.chapters.length ? button("resume", "Start reading", "secondary", `data-id="${esc(b.id)}"`) : ""}${saved && state.settings.showCoverSearch!==false ? button("search-cover-images", "Search cover images", "secondary", `data-id="${esc(b.id)}"`) : ""}${saved ? button("mobile-assign-category", "Category: " + esc(bookCategory(b)), "secondary", `data-id="${esc(b.id)}"`) : ""}</div></div></div>${sourceAlternatives(b)}${!mobile&&downloadJobs.has(b.id)?downloadQueueView():""}<div class="chapter-heading"><h3>${b.chapters.length} chapters</h3><label class="chapter-sort">Order<select id="chapter-order" aria-label="Chapter order"><option value="asc" ${chapterOrder()==="asc"?"selected":""}>Ascending</option><option value="desc" ${chapterOrder()==="desc"?"selected":""}>Descending</option></select></label>${saved && b.source !== "local" ? button("download-all", "Download all chapters", "primary", `data-id="${esc(b.id)}"`) + button("download-unread", "Download unread", "secondary", `data-id="${esc(b.id)}"`) + button("refresh-chapters", "Refresh", "secondary", `data-id="${esc(b.id)}"`) : ""}</div>${
    state.detailLoading
      ? '<div class="empty"><span class="spinner"></span> Loading chapters…</div>'
      : state.detailError
        ? `<p class="notice" role="alert">${esc(state.detailError)}</p>`
      : !saved
        ? '<p class="sub">Add this title to your library to load its chapters.</p>'
        : !b.chapters.length
          ? '<p class="sub">No readable chapters in your selected language. Try another language in Settings, then refresh.</p>'
          : `<div class="chapter-list">${orderedChapters(b)
              .map((c) => {
                const p = progressFor(b.id, c.id),
                  d = state.downloads.get(c.id);
                return `<div class="chapter-item ${p?.completed?"chapter-read":""}"><button class="chapter" data-action="read" data-id="${esc(b.id)}" data-chapter="${esc(c.id)}"><span>${p?.completed ? "✓ " : ""}<b>Chapter ${esc(c.number || "—")}</b>${c.title ? " · " + esc(c.title) : ""}<small>${esc(c.group)} · ${c.pages} pages${p && !p.completed ? " · Page " + (p.page + 1) : ""}</small></span>${icon("arrow")}</button>${b.source !== "local" ? button("download", d ? `${d.done}/${d.total}` : c.downloaded ? "✓ Offline" : icon("downloads"), "icon-button", `data-download-chapter="${esc(c.id)}" data-id="${esc(b.id)}" data-chapter="${esc(c.id)}" aria-label="${c.downloaded ? "Downloaded" : "Download chapter"}" ${d || c.downloaded ? "disabled" : ""}`) : ""}</div>`;
              })
              .join("")}</div>`
  }</section>`;
  document.body.append(layer);
  layer.addEventListener("click", (e) => {
    if (e.target === layer) closeDetail();
  });
  layer.querySelector(".close")?.focus();
  loadCovers();
}
function closeDetail() {
  state.detail = null;
  document.querySelector("#detail")?.remove();
}
async function addBook(id) {
  applySnapshot(await api("add_book", { book: bookById(id) }));
  render();
  await showDetails(id);
}
async function removeBook(id) {
  applySnapshot(await api("remove_book", { bookId: id }));
  closeDetail();
  render();
  toast("Removed from library. Original files are unchanged.");
}
async function toggleFavorite(id) {
  applySnapshot(await api("favorite", { bookId: id }));
  state.detail = bookById(id);
  render();
  renderDetails();
}
async function refreshLibrary() {
  if (state.busy) return;
  state.busy = true;
  toast("Checking your online titles for new chapters…");
  let added = 0;
  const errors = [];
  try {
    for (const b of [...state.books].filter((b) => b.source !== "local")) {
      try {
        const updated = await api("chapters", { bookId: b.id, refresh: true });
        added += updated.chapters.filter(
          (c) => !b.chapters.some((old) => old.id === c.id),
        ).length;
        state.books = state.books.map((x) => (x.id === b.id ? updated : x));
      } catch (e) {
        errors.push(`${b.title}: ${e}`);
      }
    }
    render();
    toast(
      `${added} new chapters.${errors.length ? " " + errors.join(" · ") : ""}`,
    );
  } finally {
    state.busy = false;
  }
}
async function downloadChapter(id,chapter) {
  await downloadAllChapters(id,false,[chapter]);
}
function loadCovers() {
  for (const el of document.querySelectorAll("[data-cover]")) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight + 350) continue;
    const id = el.dataset.cover;
    if (
      coverPending.has(id) ||
      coverCache.has(id) ||
      coverFailed.has(id) ||
      coverPending.size >= 3
    )
      continue;
    const b = bookById(id);
    if (
      !b ||
      !(
        ["local", "komga", "mangadex"].includes(b.source) ||
        b.source.startsWith("ext:") || b.source.startsWith("apk:")
      )
    )
      continue;
    coverPending.add(id);
    const generation=coverGeneration.get(id)||0;
    api("cover_data", { book: b })
      .then((bytes) => {
        if(generation!==(coverGeneration.get(id)||0))return;
        const url = URL.createObjectURL(new Blob([bytes]));
        if (coverCache.size >= 100) {
          const key = coverCache.keys().next().value;
          URL.revokeObjectURL(coverCache.get(key));
          coverCache.delete(key);
        }
        coverCache.set(id, url);
        for (const target of document.querySelectorAll("[data-cover]"))
          if (target.dataset.cover === id) {
            const img = document.createElement("img");
            img.className = target.className;
            img.src = url;
            img.alt = b.title + " cover";
            img.loading = "lazy";
            target.replaceWith(img);
          }
      })
      .catch(() => {if(generation!==(coverGeneration.get(id)||0))return;coverFailed.add(id);if(b.source.startsWith('apk:')&&typeof repairMissingBookExtensions==='function'&&!mangaExtensionInfo(b).installed)void repairMissingBookExtensions();if(state.detail?.id===id&&!state.reader){const info=document.querySelector('#detail .manga-source-info');if(info)info.outerHTML=mangaSourceView(b);}})
      .finally(() => {
        coverPending.delete(id);
        setTimeout(loadCovers, 0);
      });
  }
}
document.addEventListener("scroll", loadCovers, {
  capture: true,
  passive: true,
});
window.addEventListener('online',()=>{coverFailed.clear();loadCovers();});
async function resume(id) {
  const b = bookById(id);
  if (!b?.chapters.length) {
    await showDetails(id);
    return;
  }
  const p = latest(b),
    c = p
      ? b.chapters.find((c) => c.id === p.chapterId) || b.chapters[0]
      : b.chapters[0];
  await openReader(id, c.id, p?.chapterId === c.id ? p.page : 0);
}
function readerErrorMessage(error) {
  const message=String(error);
  if(/UnknownHostException|EAI_NODATA|EAI_AGAIN|ENOTFOUND|name or service not known|no such host is known|failed to lookup address|dns error/i.test(message))
    return "The source address could not be resolved. Check your internet connection and retry. For offline reading, download this chapter on this device while online first.";
  return message;
}
async function openReader(id, chapterId, page = null) {
  if (typeof stopReaderStrip === "function") await stopReaderStrip();
  const returnDetail=state.detail?.id || state.reader?.returnDetail || null;
  closeDetail();
  state.reader?.pdfRender?.cancel();
  state.reader?.pdfDocument?.destroy();
  clearPages();
  const version = ++readerVersion,
    b = bookById(id),
    c = b?.chapters.find((c) => c.id === chapterId);
  if (!c) return;
  state.reader = {
    returnDetail,
    book: b,
    chapter: c,
    page: 0,
    total: c.pages,
    pdf: false,
    loading: true,
    error: "",
    version,
  };
  renderReader();
  try {
    const meta = await api("open_chapter", { bookId: id, chapterId });
    if (state.reader?.version !== version) return;
    state.reader.total = meta.pages;
    state.reader.chapter.pages = meta.pages;
    state.reader.pdf = meta.pdf;
    if (meta.pdf && typeof usesCanvasPdf === "function" && usesCanvasPdf()) {
      const reader = state.reader;
      const pdfDocument = await openMobilePdf(await getPage(reader, 0));
      if (state.reader !== reader) { pdfDocument.destroy(); return; }
      reader.pdfDocument = pdfDocument;
      reader.total = pdfDocument.numPages;
      reader.chapter.pages = reader.total;
      meta.pages = reader.total;
    }
    state.reader.page = Math.min(
      Math.max(0, page ?? progressFor(id, chapterId)?.page ?? 0),
      Math.max(0, meta.pages - 1),
    );
    await displayPage();
  } catch (e) {
    if (state.reader?.version === version) {
      state.reader.error = readerErrorMessage(e);
      state.reader.loading = false;
      renderReader();
    }
  }
}
function clearPages() {
  for (const url of pageCache.values()) URL.revokeObjectURL(url);
  pageCache.clear();
  pagePending.clear();
}
async function getPage(r, page) {
  const key = `${r.version}:${page}`;
  if (pageCache.has(key)) return pageCache.get(key);
  if (pagePending.has(key)) return pagePending.get(key);
  const promise = api("page_data", {
    bookId: r.book.id,
    chapterId: r.chapter.id,
    page,
  })
    .then((bytes) => {
      if (state.reader?.version !== r.version) throw Error("Reader closed");
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: r.pdf ? "application/pdf" : detectMime(bytes),
        }),
      );
      pageCache.set(key, url);
      for (const [k, u] of pageCache) {
        const p = Number(k.split(":")[1]);
        if (Math.abs(p - state.reader.page) > 2) {
          URL.revokeObjectURL(u);
          pageCache.delete(k);
        }
      }
      return url;
    })
    .finally(() => pagePending.delete(key));
  pagePending.set(key, promise);
  return promise;
}
function detectMime(bytes) {
  const a = new Uint8Array(bytes);
  if (a[0] === 0x89 && a[1] === 0x50) return "image/png";
  if (a[0] === 0x47 && a[1] === 0x49) return "image/gif";
  if (a[0] === 0x52 && a[8] === 0x57) return "image/webp";
  if (a[0] === 0x42 && a[1] === 0x4d) return "image/bmp";
  if (a[4] === 0x66 && a[5] === 0x74) return "image/avif";
  return "image/jpeg";
}
async function displayPage() {
  const r = state.reader;
  if (!r) return;
  if (!r.pdf && state.settings.readerLayout === "continuous" && typeof mountReaderStrip === "function") {
    r.loading = false;
    if (r.strip) await r.strip.jump(r.chapter, r.page);
    else { renderReader(); await r.strip.ready; }
    return;
  }
  const page = r.page;
  const completed =
    !!progressFor(r.book.id, r.chapter.id)?.completed ||
    (page === r.total - 1 && (!r.pdf || !!r.pdfDocument));
  r.loading = true;
  r.error = "";
  renderReader();
  try {
    const url = r.pdfDocument ? r.url : await getPage(r, page);
    if (state.reader !== r || r.page !== page) return;
    r.url = url;
    r.loading = false;
    renderReader();
    await api("save_progress", {
      bookId: r.book.id,
      chapterId: r.chapter.id,
      page,
      completed,
      totalPages: r.pdfDocument ? r.total : null,
    });
    state.progress = state.progress.filter(
      (p) => !(p.bookId === r.book.id && p.chapterId === r.chapter.id),
    );
    state.progress.unshift({
      bookId: r.book.id,
      chapterId: r.chapter.id,
      page,
      completed,
      updated: Date.now(),
    });
    indexProgress();
    if (!r.pdf)
      for (const n of [page + 1, page - 1])
        if (n >= 0 && n < r.total) getPage(r, n).catch(() => {});
  } catch (e) {
    if (state.reader === r && r.page === page) {
      r.loading = false;
      r.error = readerErrorMessage(e);
      renderReader();
    }
  }
}
function renderReader() {
  if (state.reader?.strip) { applyReaderChrome(); return; }
  document.querySelector("#reader")?.remove();
  const r = state.reader;
  if (!r) return;
  r.fullscreen ??= typeof useMobileLayout === "function" && useMobileLayout();
  r.controlsVisible ??= !r.fullscreen;
  const el = document.createElement("section");
  el.id = "reader";
  el.className = "reader";
  el.innerHTML = `<div class="reader-bar">${button("close-reader", icon("back"), "icon-button", 'aria-label="Close reader"')}<div class="reader-title">${esc(r.book.title)}<small>Chapter ${esc(r.chapter.number)} · ${esc(r.chapter.title || r.chapter.group)}</small></div><div class="reader-controls"><select id="reader-fit" aria-label="Page fit">${[
    ["width", "Fit width"],
    ["height", "Fit page"],
    ["original", "Original size"],
  ]
    .map(
      ([k, v]) =>
        `<option value="${k}" ${state.settings.fit === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select><select id="reader-direction" aria-label="Reading direction"><option value="ltr" ${state.settings.direction === "ltr" ? "selected" : ""}>Left to right</option><option value="rtl" ${state.settings.direction === "rtl" ? "selected" : ""}>Right to left</option></select>${button("fullscreen", "⛶", "icon-button", 'aria-label="Toggle fullscreen"')}</div></div><div class="reading-stage ${esc(state.settings.fit)}">${r.error ? `<div class="empty error-box">${esc(r.error)}${button("retry-page", "Retry", "primary")}</div>` : r.loading ? '<div class="reader-loading"><span class="spinner"></span> Loading page…</div>' : r.pdfDocument ? '<canvas class="reading-page"></canvas>' : r.pdf ? `<iframe class="pdf-document" title="PDF reader" src="${esc(r.url)}"></iframe>` : `<img class="reading-page" src="${esc(r.url)}" alt="Page ${r.page + 1}" decoding="async" data-action="page-click">`}</div><div class="reading-bottom">${button("previous-chapter", "Previous chapter")}${button("previous-page", icon("back"), "icon-button", `aria-label="Previous page" ${r.page === 0 ? "disabled" : ""}`)}<label class="page-jump">${r.pdf ? "PDF document" : `<input id="page-jump" type="number" min="1" max="${r.total}" value="${r.page + 1}" aria-label="Jump to page"> / ${r.total}`}</label>${button("next-page", icon("arrow"), "icon-button", `aria-label="Next page" ${r.page >= r.total - 1 ? "disabled" : ""}`)}${button("next-chapter", "Next chapter", "primary")}${r.pdf ? button("mark-read", "Mark read") : ""}</div>`;
  document.body.append(el);
  const layout = document.createElement("select");
  layout.id = "reader-layout";
  layout.setAttribute("aria-label", "Reader layout");
  layout.innerHTML = `<option value="paged">Single page</option><option value="continuous" ${r.pdf ? "disabled" : ""}>Continuous strip</option>`;
  layout.value = r.pdf ? "paged" : (state.settings.readerLayout || "paged");
  el.querySelector(".reader-controls").prepend(layout);
  el.querySelector(".reading-stage").dataset.action = "page-click";
  applyReaderChrome();
  if (!r.loading && !r.pdf && state.settings.readerLayout === "continuous" && typeof mountReaderStrip === "function") {
    mountReaderStrip(r, el);
    return;
  }
  if (r.pdfDocument && !r.loading && !r.error) {
    const canvas = document.createElement("canvas");
    canvas.className = "reading-page";
    canvas.setAttribute("aria-label", `PDF page ${r.page + 1}`);
    el.querySelector(".reading-stage").replaceChildren(canvas);
    const jump = el.querySelector(".page-jump");
    jump.innerHTML = `<input id="page-jump" type="number" min="1" max="${r.total}" value="${r.page + 1}" aria-label="Jump to page"> / ${r.total}`;
    renderMobilePdf(r, canvas).catch(error => {
      if (state.reader === r && canvas.isConnected) { r.error = String(error); renderReader(); }
    });
  }
}
async function turnPage(delta) {
  const r = state.reader;
  if (!r || (r.pdf && !r.pdfDocument)) return;
  if (r.strip) { await r.strip.move(delta); return; }
  const next = r.page + delta;
  if (next < 0 || next >= r.total) return;
  r.page = next;
  await displayPage();
}
async function nextChapter(delta) {
  const r = state.reader;
  if (!r) return;
  const c =
    r.book.chapters[
      r.book.chapters.findIndex((c) => c.id === r.chapter.id) + delta
    ];
  if (c && r.strip) await r.strip.jump(c, 0);
  else if (c) await openReader(r.book.id, c.id, 0);
  else
    toast(
      delta > 0
        ? "You’ve reached the latest chapter."
        : "This is the first chapter.",
    );
}
function applyReaderChrome() {
  const r = state.reader;
  const restoreView = r?.strip?.captureView();
  const immersive = !!r?.fullscreen && !r.controlsVisible;
  document.body.classList.toggle("reader-open", !!r);
  document.querySelector("#reader")?.classList.toggle("reader-immersive", immersive);
  globalThis.MreaderChrome?.setImmersive(immersive);
  restoreView?.();
}
function setReaderFullscreen(enabled) {
  if (!state.reader) return;
  state.reader.fullscreen = enabled;
  state.reader.controlsVisible = !enabled;
  applyReaderChrome();
}
function closeReader() {
  const returnDetail=state.reader?.returnDetail;
  if (typeof stopReaderStrip === "function") stopReaderStrip();
  readerVersion++;
  state.reader?.pdfRender?.cancel();
  state.reader?.pdfDocument?.destroy();
  state.reader = null;
  applyReaderChrome();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.querySelector("#reader")?.remove();
  clearPages();
  render();
  if(returnDetail && bookById(returnDetail)){state.detail=bookById(returnDetail);renderDetails();}
}
function handleAppBack() {
  const coverSearch=document.querySelector("#cover-image-search");if(coverSearch){coverSearch.remove();return true;}
  if(state.reader || state.detail || state.mobileSearch || navigationHistory.length || document.querySelector('#mobile-sheet') || state.page!=='Library')lastRootBack=0;
  if(document.querySelector('#mobile-sheet')){closeMobileSheet();return true;}
  if(state.reader){closeReader();return true;}
  if(state.detail){closeDetail();return true;}
  if(state.mobileSearch){state.mobileSearch=false;state.query='';render();return true;}
  const previous=navigationHistory.pop();
  if(previous){
    searchVersion++;clearTimeout(searchTimer);
    Object.assign(state,previous,{error:'',loading:false});render();
    if(state.page==='Browse')searchSource().catch(toast);
    return true;
  }
  if(state.page!=='Library'){navigate('Library',false).catch(toast);return true;}
  const now=Date.now();
  if(lastRootBack && now-lastRootBack<2000){lastRootBack=0;return false;}
  lastRootBack=now;toast('Swipe back again to leave Mreader');return true;
}
function settingsContentView() {
  const s = state.settings;
  return `<div class="heading"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Settings</h1><p class="sub">A reading space that feels like yours.</p></div></div>${typeof accountView === "function" ? accountView() : ""}${typeof extensionView === "function" ? extensionView() : ""}<form id="settings-form"><div class="settings-row"><div><h3>Cover image search</h3><p>Show Search cover images in manga previews.</p></div><input name="showCoverSearch" type="checkbox" role="switch" aria-label="Show cover image search" ${s.showCoverSearch!==false?"checked":""}></div><div class="settings-row"><div><h3>Startup page</h3><p>Choose the page Mreader opens on this device.</p></div><select name="startPage" aria-label="Startup page">${["Library","Updates","History","Browse","Downloads"].map(page=>`<option ${page===(s.startPage || "Library")?"selected":""}>${page}</option>`).join("")}</select></div><div class="settings-row"><div><h3>Appearance</h3><p>Your preferred library theme.</p></div><select name="theme"><option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option></select></div><div class="settings-row"><div><h3>Chapter language</h3><p>Applies to MangaDex searches and chapter refreshes.</p></div><select name="language">${Object.entries(
    {
      en: "English",
      es: "Spanish",
      "es-la": "Spanish (Latin America)",
      "pt-br": "Portuguese (Brazil)",
      fr: "French",
      ja: "Japanese",
      de: "German",
      it: "Italian",
    },
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${s.language === k ? "selected" : ""}>${v}</option>`,
    )
    .join(
      "",
    )}</select></div>${typeof useMobileLayout === "function" && useMobileLayout() ? `<div class="settings-row"><div><h3>Data saver</h3><p>Use smaller MangaDex pages to save bandwidth.</p></div><input name="dataSaver" type="checkbox" ${s.dataSaver ? "checked" : ""}></div>` : ""}<div class="settings-save"><button class="primary" type="submit">Save preferences</button></div></form><div class="settings-row"><div><h3>Local manga</h3><p>CBZ, ZIP, CBR, RAR, PDF, or image folders. Drop files anywhere to import.</p><p>Files stay in place. CBR/RAR uses 7-Zip; PDF uses the built-in viewer.</p></div><div class="button-row">${button("import", "Import files")}${button("import-folder", "Import folder")}</div></div><div class="settings-row"><div><h3>Backups</h3><p>Metadata, reading progress, preferences and custom cover art. Manga files and passwords are excluded.</p><p>Restore merges with your library. Downloads may need downloading again.</p></div><div class="button-row">${button("export", "Export backup")}${button("restore", "Restore backup")}</div></div><div class="settings-row"><div><h3>Mreader</h3><p>Manga reading on desktop, phones and tablets.</p></div><span class="sub">Mreader</span></div>`;
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t || t.disabled) return;
  const a = t.dataset.action,
    id = t.dataset.id,
    c = t.dataset.chapter;
  try {
    switch (a) {
      case "toggle-sidebar":
        applySnapshot(await api("save_settings", {settings:{...state.settings,sidebarCollapsed:!state.settings.sidebarCollapsed,komgaPassword:""}}));
        render();
        break;
      case "nav":
        await navigate(t.dataset.page);
        break;
      case "browse":
        await navigate("Browse");
        break;
      case "collection":
        state.page = "Library";
        state.tab = t.dataset.tab;
        state.query = "";
        render();
        break;
      case "tab":
        state.tab = t.dataset.tab;
        render();
        break;
      case "grid":
        state.list = false;
        render();
        break;
      case "list":
        state.list = true;
        render();
        break;
      case "import":
        await importFiles();
        break;
      case "import-folder":
        await importFiles(true);
        break;
      case "details":
        await showDetails(id);
        break;
      case "close-detail":
        closeDetail();
        break;
      case "add":
        await addBook(id);
        break;
      case "remove":
        await removeBook(id);
        break;
      case "favorite":
        await toggleFavorite(id);
        break;
      case "refresh-chapters":
        await showDetails(id, true);
        break;
      case "refresh-source":
        await searchSource(false,true);
        break;
      case "load-more":
        await searchSource(true);
        break;
      case "refresh-library":
        await refreshLibrary();
        break;
      case "reload":
        await reload();
        break;
      case "read":
        await openReader(id, c, progressFor(id,c)?.completed ? 0 : null);
        break;
      case "resume":
        await resume(id);
        break;
      case "download":
        await downloadChapter(id, c);
        break;
      case "close-reader":
        closeReader();
        break;
      case "previous-page":
        await turnPage(-1);
        break;
      case "next-page":
        await turnPage(1);
        break;
      case "previous-chapter":
        await nextChapter(-1);
        break;
      case "next-chapter":
        await nextChapter(1);
        break;
      case "retry-page":
        if (state.reader)
          await openReader(
            state.reader.book.id,
            state.reader.chapter.id,
            state.reader.page,
          );
        break;
      case "page-click":
        if ((state.reader?.fullscreen || (typeof useMobileLayout === "function" && useMobileLayout())) && e.clientX >= window.innerWidth / 3 && e.clientX <= window.innerWidth * 2 / 3) {
          state.reader.controlsVisible = !state.reader.controlsVisible;
          applyReaderChrome();
          break;
        }
        await turnPage(
          (e.clientX < window.innerWidth / 2 ? -1 : 1) *
            (state.settings.direction === "rtl" ? -1 : 1),
        );
        break;
      case "fullscreen":
        if (state.reader?.fullscreen) {
          setReaderFullscreen(false);
          if (document.fullscreenElement) await document.exitFullscreen();
        } else {
          setReaderFullscreen(true);
          if (!globalThis.MreaderChrome) await document.documentElement.requestFullscreen?.();
        }
        break;
      case "mark-read": {
        const r = state.reader;
        await api("save_progress", {
          bookId: r.book.id,
          chapterId: r.chapter.id,
          page: 0,
          completed: true,
        });
        toast("PDF marked as read");
        await reload();
        break;
      }
      case "export":
        if (await api("export_backup")) toast("Backup exported");
        break;
      case "restore":
        applySnapshot(await api("restore_backup"));
        render();
        toast("Backup restored. Checking current sources…");
        void refreshRestoredBooks(state.books.map(b=>b.id));
        break;
    }
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "search") return;
  state.query = e.target.value;
  clearTimeout(searchTimer);
  if (state.page === "Browse") {
    searchVersion++;
    searchTimer = setTimeout(() => searchSource(), 400);
  } else {
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector("#search");
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
document.addEventListener("change", async (e) => {
  try {
    if(e.target.id==='source-manager-select'){
      featureState.browseSourceChosen=true;
      if(e.target.value!=='all')await api('source_prefer',{source:e.target.value});
      state.source=e.target.value;render();return;
    }
    if (e.target.id === "source") {
      featureState.browseSourceChosen = true;
      if(e.target.value!=='all')await api('source_prefer',{source:e.target.value});
      state.source = e.target.value;
      await searchSource();
    }
    if (e.target.id === "sort") {
      state.sort = e.target.value;
      render();
    }
    if (["reader-fit", "reader-direction", "reader-layout"].includes(e.target.id)) {
      const current = state.reader;
      const position = current && {book:current.book.id,chapter:current.chapter.id,page:current.page,fullscreen:current.fullscreen,controlsVisible:current.controlsVisible};
      if (current?.strip) await stopReaderStrip();
      state.settings[{"reader-fit":"fit", "reader-direction":"direction", "reader-layout":"readerLayout"}[e.target.id]] =
        e.target.value;
      applySnapshot(
        await api("save_settings", {
          settings: { ...state.settings, komgaPassword: "" },
        }),
      );
      if (current) {
        await openReader(position.book, position.chapter, position.page);
        if (state.reader) {
          state.reader.fullscreen = position.fullscreen;
          state.reader.controlsVisible = position.controlsVisible;
          applyReaderChrome();
        }
      }
    }
    if (e.target.id === "page-jump" && state.reader) {
      state.reader.page = Math.max(
        0,
        Math.min(state.reader.total - 1, Number(e.target.value) - 1 || 0),
      );
      await displayPage();
    }
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    applySnapshot(
      await api("save_settings", {
        settings: {
          ...state.settings,
          showCoverSearch: f.has("showCoverSearch"),
          startPage: f.get("startPage"),
          theme: f.get("theme"),
          language: f.get("language"),
          dataSaver: typeof useMobileLayout === "function" && useMobileLayout() ? f.has("dataSaver") : state.settings.dataSaver,
          komgaUrl: (f.get("komgaUrl") ?? state.settings.komgaUrl).trim().replace(/\/$/, ""),
          komgaUser: f.get("komgaUser") ?? state.settings.komgaUser,
          komgaPassword: f.get("komgaPassword") || "",
        },
      }),
    );
    render();
    toast("Preferences saved");
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (state.reader) closeReader();
    else closeDetail();
    return;
  }
  if (e.target.matches("input,select,textarea")) return;
  if (e.key === "Enter" && e.target.matches('[role="button"]'))
    e.target.click();
  if (state.reader && ["ArrowRight", "ArrowLeft", " "].includes(e.key)) {
    e.preventDefault();
    turnPage(
      e.key === " "
        ? 1
        : (e.key === "ArrowLeft" ? -1 : 1) *
            (state.settings.direction === "rtl" ? -1 : 1),
    ).catch(toast);
  }
});
async function boot() {
  render();
  if (!native) {
    state.error =
      "The reader runs in the native Rust desktop app. Start it with npm start.";
    render();
    return;
  }
  try {
    const verification =
      typeof loadFeatures === "function"
        ? await loadFeatures()
        : { enabled: false };
    await loadDownloadQueue();
    applySnapshot(await api("snapshot"));
    state.page = ["Library","Updates","History","Browse","Downloads"].includes(state.settings.startPage) ? state.settings.startPage : "Library";
    if(typeof ensureUserSource === "function"){if(userSources().length)state.source='all';ensureUserSource();}
    render();
    if(!verification.enabled&&typeof repairMissingBookExtensions==='function')void repairMissingBookExtensions();
    if(state.page === "Browse" && !verification.enabled)await searchSource();
    await window.__TAURI__.event.listen("download-progress", (event) => {
      state.downloads.set(event.payload.chapterId, event.payload);
      updateDownloadProgress();
    });
    await window.__TAURI__.webviewWindow
      .getCurrentWebviewWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop")
          importFiles(false, event.payload.paths).catch(toast);
      });
    if (verification.enabled) await runVerification(verification);
  } catch (e) {
    state.error = String(e);
    render();
  }
}
boot();
