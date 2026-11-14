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
  const result = await nativeInvoke(name, args);
  if (
    [
      "save_progress",
      "add_book",
      "remove_book",
      "favorite",
      "set_book_category",
      "import_paths",
      "import_files",
      "chapters",
    ].includes(name) &&
    typeof queueAccountSync === "function"
  )
    queueAccountSync();
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
    dataSaver: false,
    komgaUrl: "",
    komgaUser: "",
  },
  page: "Library",
  tab: "All",
  query: "",
  source: "mangadex",
  catalog: [],
  total: 0,
  sort: "Recent",
  list: false,
  loading: false,
  error: "",
  dataDir: "",
  detail: null,
  detailLoading: false,
  reader: null,
  downloads: new Map(),
  busy: false,
};
const coverCache = new Map(),
  coverPending = new Set(),
  coverFailed = new Set(),
  pageCache = new Map(),
  pagePending = new Map();
let searchTimer,
  searchVersion = 0,
  readerVersion = 0,
  toastTimer;
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
  state.books = s.books;
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
    : `<div class="${cls} cover-placeholder" data-cover="${esc(b.id)}">${icon("book")}<span>${esc(b.title)}</span></div>`;
}
function card(b) {
  const saved = state.books.some((x) => x.id === b.id),
    count = unread(b),
    dl = b.chapters.filter((c) => c.downloaded).length;
  return `<article class="card" tabindex="0" role="button" data-action="details" data-id="${esc(b.id)}" aria-label="Open ${esc(b.title)}"><div class="cover">${cover(b)}<div class="badges">${count ? `<span class="badge">${count}</span>` : ""}${dl ? `<span class="badge download">↓ ${dl}</span>` : ""}${saved && state.page === "Browse" ? '<span class="badge download">In library</span>' : ""}</div>${b.favorite ? '<span class="cover-favorite">♥</span>' : ""}</div><h3>${esc(b.title)}</h3><p><i class="status-dot"></i>${esc(b.status || "Unknown")}<span class="source-tag">${typeof sourceLabel === "function" ? esc(sourceLabel(b.source)) : esc(b.source)}</span></p></article>`;
}
function filtered() {
  let data =
    state.page === "Browse"
      ? state.catalog.map((b) => state.books.find((x) => x.id === b.id) || b)
      : [...state.books];
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
function hero() {
  const p = [...state.progress]
    .sort((a, b) => b.updated - a.updated)
    .find((p) =>
      state.books.some(
        (b) =>
          b.id === p.bookId && b.chapters.some((c) => c.id === p.chapterId),
      ),
    );
  if (!p)
    return `<section class="hero welcome"><div class="welcome-icon">${icon("book")}</div><div><div class="eyebrow">YOUR NEXT CHAPTER STARTS HERE</div><h2>A whole world of stories.</h2><p>Discover manga online, or bring your collection from home.</p><div class="button-row">${button("browse", icon("browse") + " Discover manga", "primary")}${button("import", icon("plus") + " Import files")}</div></div></section>`;
  const b = bookById(p.bookId),
    c = b.chapters.find((c) => c.id === p.chapterId);
  return `<section class="hero">${cover(b, "hero-cover")}<div><div class="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h2>${esc(b.title)}</h2><p>Chapter ${esc(c.number)} · Page ${p.page + 1} of ${c.pages || "?"}</p>${button("resume", icon("book") + " Continue reading " + icon("arrow"), "primary", `data-id="${esc(b.id)}"`)}</div><div class="progress-info">Your journey so far<div class="progress-track"><i style="width:${Math.min(100, ((p.page + 1) / Math.max(1, c.pages)) * 100)}%"></i></div>${unread(b)} chapters left to explore</div></section>`;
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
    `<div class="shell"><aside class="sidebar"><div class="brand">${icon("book")}<span>mreader<small>YOUR NEXT CHAPTER</small></span></div><nav class="nav">${["Library", "Updates", "History", "Browse", "Downloads"].map((p) => `<button data-action="nav" data-page="${p}" class="${state.page === p ? "active" : ""}">${icon(p.toLowerCase())}<span>${p}</span>${p === "Updates" && count ? `<span class="count">${count}</span>` : ""}</button>`).join("")}</nav><div class="side-label">YOUR COLLECTIONS</div>${["Favorites", "Reading", "Completed", "Local"].map((c, i) => `<button class="collection" data-action="collection" data-tab="${c}"><i class="dot" style="background:${["#c7b2ec", "#8aaf9c", "#c6a87d", "#88a5c7"][i]}"></i>${c}</button>`).join("")}<div class="side-bottom"><nav class="nav"><button data-action="nav" data-page="Settings" class="${state.page === "Settings" ? "active" : ""}">${icon("settings")}<span>Settings</span></button></nav><div class="storage"><b>Your stories. Your space.</b>${state.books.length} titles · ${state.books.filter((b) => b.source === "local").length} local<div class="storage-bar"><i></i></div>Rust core · v0.3.1</div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span> <b>${state.page}</b></div><div class="top-right"><span class="engine-status"><i class="status-dot"></i>${native ? "Rust engine connected" : "Desktop app required"}</span><div class="avatar">ME</div></div></header>${state.page === "Settings" ? settingsView() : `<div class="heading"><div><div class="eyebrow">YOUR PERSONAL MANGA SPACE</div><h1>${state.page === "Library" ? "My library" : state.page === "Browse" ? "Discover your next story" : state.page}</h1><p class="sub">${{ Library: "All your stories. Right where you left them.", Browse: "Real stories from MangaDex and your Komga server.", History: "Every story you’ve spent a little time with.", Downloads: "Chapters saved on this computer, ready to read offline.", Updates: "Unread chapters from your online collection." }[state.page]}</p></div><div class="button-row">${button("import", icon("plus") + " Import files")}${button(state.page === "Browse" ? "refresh-source" : state.page === "Updates" ? "refresh-library" : "browse", icon(state.page === "Updates" ? "updates" : "browse") + (state.page === "Browse" ? " Refresh" : state.page === "Updates" ? " Check updates" : " Browse manga"), "primary")}</div></div>${state.page === "Library" ? hero() : ""}${state.page === "Browse" ? `<div class="source-row"><label>Source <select id="source"><option value="mangadex" ${state.source === "mangadex" ? "selected" : ""}>MangaDex</option><option value="komga" ${state.source === "komga" ? "selected" : ""}>Komga · personal server</option>${typeof extensionOptions === "function" ? extensionOptions() : ""}</select></label><span>${esc(state.settings.language.toUpperCase())} chapters · ${state.total.toLocaleString()} titles</span></div>` : ""}<div class="tabs-row">${["All", "Reading", "Completed", "Favorites", "Local"].map((t) => `<button class="tab ${state.tab === t ? "active" : ""}" data-action="tab" data-tab="${t}">${t}${t === "All" ? `<span>${state.page === "Browse" ? state.catalog.length : state.books.length}</span>` : ""}</button>`).join("")}</div><div class="tools"><label class="search">${icon("search")}<input id="search" aria-label="Search manga" placeholder="${state.page === "Browse" ? "Search source…" : "Search your library…"}" value="${esc(state.query)}"></label><div class="toolbar-right"><span class="result-count">${data.length} titles</span><select id="sort" aria-label="Sort titles">${["Recent", "Title A–Z", "Unread chapters", "Recently read"].map((s) => `<option ${state.sort === s ? "selected" : ""}>${s}</option>`).join("")}</select><div class="view-switch">${button("grid", icon("grid"), !state.list ? "active" : "", 'aria-label="Grid view"')}${button("list", icon("list"), state.list ? "active" : "", 'aria-label="List view"')}</div></div></div>${state.error ? `<div class="error-box" role="alert">${esc(state.error)} ${button(state.page === "Browse" ? "refresh-source" : "reload", "Retry")}</div>` : ""}<div class="grid ${state.list ? "list" : ""}">${data.map(card).join("")}${state.loading ? '<div class="empty"><span class="spinner"></span> Connecting to source…</div>' : !data.length ? `<div class="empty">${icon("book")}<h3>${state.page === "Library" ? "Your library is a blank page." : "No titles here yet."}</h3><p>${state.query ? "Try another search." : state.page === "Browse" ? "Choose a source and search for a title." : "Browse manga or import CBZ, CBR, PDF, and image folders."}</p>${button("browse", "Discover manga", "primary")} ${button("import-folder", "Import folder")}</div>` : ""}</div>${state.page === "Browse" && state.catalog.length < state.total && !state.loading ? `<div class="load-more">${button("load-more", "Load more titles")}</div>` : ""}<footer class="footer"><span>${state.page === "Browse" ? "Connected to " + (typeof sourceLabel === "function" ? esc(sourceLabel(state.source)) : state.source) : state.books.length + " stories. Countless worlds to get lost in."}</span><span>Local-first storage · Rust + WebView2</span></footer>`}</main></div>`;
  loadCovers();
  if (searchFocus !== null) {
    const input = document.querySelector("#search");
    input?.focus();
    input?.setSelectionRange(searchFocus, searchFocus);
  }
}
async function navigate(page) {
  searchVersion++;
  clearTimeout(searchTimer);
  state.page = page;
  state.tab = "All";
  state.query = "";
  state.error = "";
  state.loading = false;
  render();
  if (page === "Browse") await searchSource();
}
async function reload() {
  applySnapshot(await api("snapshot"));
  render();
}
async function searchSource(more = false) {
  const version = ++searchVersion;
  state.loading = true;
  state.error = "";
  if (!more) state.catalog = [];
  const q = state.query,
    start = more ? state.catalog.length : 0;
  render();
  try {
    const result = await api("search_source", {
      source: state.source,
      query: q,
      offset: start,
    });
    if (version !== searchVersion || state.page !== "Browse") return;
    state.catalog = more ? [...state.catalog, ...result.books] : result.books;
    state.total = result.total;
  } catch (e) {
    if (version === searchVersion) state.error = String(e);
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
  renderDetails();
  if (state.books.some((x) => x.id === id) && (refresh || !b.chapters.length)) {
    state.detailLoading = true;
    renderDetails();
    try {
      b = await api("chapters", { bookId: id, refresh });
      state.books = state.books.map((x) => (x.id === id ? b : x));
      if (state.detail?.id === id) state.detail = b;
    } catch (e) {
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
  const saved = state.books.some((x) => x.id === b.id),
    layer = document.createElement("div");
  layer.id = "detail";
  layer.className = "modal-backdrop";
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="${esc(b.title)}">${button("close-detail", icon("close"), "icon-button close", 'aria-label="Close details"')}<div class="detail-top"><div class="detail-cover"><div class="cover">${cover(b)}</div></div><div><div class="eyebrow">${esc(b.source.toUpperCase())} · ${esc(b.status)}</div><h2>${esc(b.title)}</h2><p class="sub">${esc(b.author)}</p><div class="tags">${b.tags
    .filter(tag => !tag.startsWith("mreader:category:"))
    .slice(0, 4)
    .map((t) => `<span>${esc(t)}</span>`)
    .join(
      "",
    )}</div><p class="description">${esc(b.description || "No description available.")}</p><div class="button-row">${button(saved ? "remove" : "add", icon(saved ? "library" : "plus") + (saved ? " Remove from library" : " Add to library"), "primary", `data-id="${esc(b.id)}"`)}${saved ? button("favorite", icon("heart"), `secondary ${b.favorite ? "favorited" : ""}`, `data-id="${esc(b.id)}" aria-label="Toggle favorite"`) : ""}${saved && b.chapters.length ? button("resume", "Start reading", "secondary", `data-id="${esc(b.id)}"`) : ""}${saved && typeof useMobileLayout === "function" && useMobileLayout() ? button("mobile-move-category", bookCategory(b) === "nsfw" ? "Move to Default" : "Move to nsfw", "secondary", `data-id="${esc(b.id)}"`) : ""}</div></div></div><div class="chapter-heading"><h3>${b.chapters.length} chapters</h3>${saved && b.source !== "local" ? button("refresh-chapters", "Refresh", "secondary", `data-id="${esc(b.id)}"`) : ""}</div>${
    state.detailLoading
      ? '<div class="empty"><span class="spinner"></span> Loading chapters…</div>'
      : !saved
        ? '<p class="sub">Add this title to your library to load its chapters.</p>'
        : !b.chapters.length
          ? '<p class="sub">No readable chapters in your selected language. Try another language in Settings, then refresh.</p>'
          : `<div class="chapter-list">${b.chapters
              .map((c) => {
                const p = progressFor(b.id, c.id),
                  d = state.downloads.get(c.id);
                return `<div class="chapter-item"><button class="chapter" data-action="read" data-id="${esc(b.id)}" data-chapter="${esc(c.id)}"><span>${p?.completed ? "✓ " : ""}<b>Chapter ${esc(c.number || "—")}</b>${c.title ? " · " + esc(c.title) : ""}<small>${esc(c.group)} · ${c.pages} pages${p && !p.completed ? " · Page " + (p.page + 1) : ""}</small></span>${icon("arrow")}</button>${b.source !== "local" ? button("download", d ? `${d.done}/${d.total}` : c.downloaded ? "✓ Offline" : icon("downloads"), "icon-button", `data-id="${esc(b.id)}" data-chapter="${esc(c.id)}" aria-label="${c.downloaded ? "Downloaded" : "Download chapter"}" ${d || c.downloaded ? "disabled" : ""}`) : ""}</div>`;
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
async function downloadChapter(id, chapter) {
  if (state.downloads.has(chapter)) return;
  state.downloads.set(chapter, { done: 0, total: 0 });
  renderDetails();
  try {
    const b = await api("download_chapter", { bookId: id, chapterId: chapter });
    state.books = state.books.map((x) => (x.id === id ? b : x));
    if (state.detail?.id === id) state.detail = b;
    toast("Chapter saved for offline reading");
  } finally {
    state.downloads.delete(chapter);
    render();
    if (state.detail) renderDetails();
  }
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
        b.source.startsWith("ext:")
      )
    )
      continue;
    coverPending.add(id);
    api("cover_data", { book: b })
      .then((bytes) => {
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
      .catch(() => coverFailed.add(id))
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
async function openReader(id, chapterId, page = null) {
  closeDetail();
  state.reader?.pdfRender?.cancel();
  state.reader?.pdfDocument?.destroy();
  clearPages();
  const version = ++readerVersion,
    b = bookById(id),
    c = b?.chapters.find((c) => c.id === chapterId);
  if (!c) return;
  state.reader = {
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
      state.reader.error = String(e);
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
      r.error = String(e);
      renderReader();
    }
  }
}
function renderReader() {
  document.querySelector("#reader")?.remove();
  const r = state.reader;
  if (!r) return;
  const el = document.createElement("section");
  el.id = "reader";
  el.className = "reader";
  el.innerHTML = `<div class="reader-bar">${button("close-reader", icon("back"), "icon-button", 'aria-label="Close reader"')}<div class="reader-title">${esc(r.book.title)}<small>Chapter ${esc(r.chapter.number)} · ${esc(r.chapter.title || r.chapter.group)}</small></div><div class="reader-controls"><select id="reader-fit" aria-label="Page fit">${[
    ["width", "Fit width"],
    ["height", "Fit height"],
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
  if (c) await openReader(r.book.id, c.id, 0);
  else
    toast(
      delta > 0
        ? "You’ve reached the latest chapter."
        : "This is the first chapter.",
    );
}
function closeReader() {
  readerVersion++;
  state.reader?.pdfRender?.cancel();
  state.reader?.pdfDocument?.destroy();
  state.reader = null;
  document.querySelector("#reader")?.remove();
  clearPages();
  render();
}
function settingsView() {
  const s = state.settings;
  return `<div class="heading"><div><div class="eyebrow">MAKE YOURSELF AT HOME</div><h1>Settings</h1><p class="sub">A reading space that feels like yours.</p></div></div>${typeof accountView === "function" ? accountView() : ""}${typeof extensionView === "function" ? extensionView() : ""}<form id="settings-form"><div class="settings-row"><div><h3>Appearance</h3><p>Your preferred library theme.</p></div><select name="theme"><option value="dark" ${s.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${s.theme === "light" ? "selected" : ""}>Light</option></select></div><div class="settings-row"><div><h3>Chapter language</h3><p>Applies to MangaDex searches and chapter refreshes.</p></div><select name="language">${Object.entries(
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
    )}</select></div><div class="settings-row"><div><h3>Data saver</h3><p>Use smaller MangaDex pages to save bandwidth.</p></div><input name="dataSaver" type="checkbox" ${s.dataSaver ? "checked" : ""}></div><div class="settings-row"><div><h3>Komga server</h3><p>Connect your library. Passwords use the secure credential store on this device.</p><p>Use HTTPS for remote servers. Leave password blank to keep the saved credential.</p></div><div class="server-fields"><input name="komgaUrl" type="url" placeholder="http://localhost:25600" value="${esc(s.komgaUrl)}" aria-label="Komga server URL"><input name="komgaUser" placeholder="Email / username" value="${esc(s.komgaUser)}" aria-label="Komga username"><input name="komgaPassword" type="password" placeholder="Password (leave blank to keep)" autocomplete="new-password" aria-label="Komga password"></div></div><div class="settings-save"><button class="primary" type="submit">Save preferences</button></div></form><div class="settings-row"><div><h3>Local manga</h3><p>CBZ, ZIP, CBR, RAR, PDF, or image folders. Drop files anywhere to import.</p><p>Files stay in place. CBR/RAR uses 7-Zip; PDF uses the built-in viewer.</p></div><div class="button-row">${button("import", "Import files")}${button("import-folder", "Import folder")}</div></div><div class="settings-row"><div><h3>Backups</h3><p>Metadata, progress, and preferences. Manga files and passwords are excluded.</p><p>Restore merges with your library. Downloads may need downloading again.</p></div><div class="button-row">${button("export", "Export backup")}${button("restore", "Restore backup")}</div></div><div class="settings-row"><div><h3>Mreader 0.3.1</h3><p>Rust · SQLite · System WebView. Independent project inspired by Mihon.</p><p class="data-path">${esc(state.dataDir)}</p></div><span class="sub">${native ? "Native app" : "Browser preview"}</span></div>`;
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t || t.disabled) return;
  const a = t.dataset.action,
    id = t.dataset.id,
    c = t.dataset.chapter;
  try {
    switch (a) {
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
        await searchSource();
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
        await openReader(id, c);
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
        await turnPage(
          (e.clientX < window.innerWidth / 2 ? -1 : 1) *
            (state.settings.direction === "rtl" ? -1 : 1),
        );
        break;
      case "fullscreen":
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
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
        toast("Backup restored");
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
    if (e.target.id === "source") {
      state.source = e.target.value;
      await searchSource();
    }
    if (e.target.id === "sort") {
      state.sort = e.target.value;
      render();
    }
    if (["reader-fit", "reader-direction"].includes(e.target.id)) {
      state.settings[e.target.id === "reader-fit" ? "fit" : "direction"] =
        e.target.value;
      applySnapshot(
        await api("save_settings", {
          settings: { ...state.settings, komgaPassword: "" },
        }),
      );
      renderReader();
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
          theme: f.get("theme"),
          language: f.get("language"),
          dataSaver: f.has("dataSaver"),
          komgaUrl: f.get("komgaUrl").trim().replace(/\/$/, ""),
          komgaUser: f.get("komgaUser"),
          komgaPassword: f.get("komgaPassword"),
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
    applySnapshot(await api("snapshot"));
    render();
    await window.__TAURI__.event.listen("download-progress", (event) => {
      state.downloads.set(event.payload.chapterId, event.payload);
      if (state.detail) renderDetails();
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
