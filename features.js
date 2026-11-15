// Native extension management and managed account sync. No credentials enter page storage.
const featureState = {
  settingsTab: "general",
  mobileDownload: null,
  mobileDownloadError: "",
  mobileDownloadBusy: false,
  extensions: [],
  apk: {repositories: [], installed: []},
  apkQuery: "",
  apkBusy: false,
  cloud: { configured: false, signedIn: false },
  syncing: false,
  syncError: "",
  syncTimer: null,
  syncedSources: [],
  sourceSyncErrors: [],
  plan: null,
};
function settingsView() {
  const content=settingsContentView();
  if(typeof useMobileLayout==='function' && useMobileLayout())return content+migrationView();
  const sections=[['general','General'],['account','Account & sync'],['sources','Sources'],['mobile','Mobile app'],['storage','Files & backup']];
  const selected=sections.some(([id])=>id===featureState.settingsTab)?featureState.settingsTab:'general';
  const formStart=content.indexOf('<form id="settings-form">');
  const formEnd=content.indexOf('</form>',formStart)+7;
  const panels={general:()=>content.slice(formStart,formEnd),account:accountView,sources:extensionView,mobile:mobileInstallView,storage:()=>content.slice(formEnd)+migrationView()};
  return `<div class="heading"><div><h1>Settings</h1><p class="sub">Personalize your reader, manage sources, and connect your devices.</p></div></div><div class="settings-workspace"><nav class="settings-navigation" role="tablist" aria-label="Settings sections">${sections.map(([id,label])=>`<button role="tab" id="settings-tab-${id}" aria-controls="settings-panel" aria-selected="${selected===id}" class="${selected===id?'active':''}" data-action="settings-section" data-section="${id}">${label}</button>`).join('')}</nav><section id="settings-panel" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-${selected}">${panels[selected]()}</section></div>`;
}
function mobileInstallView() {
  const code=featureState.mobileDownload;
  return `<section class="feature-panel mobile-install"><div class="feature-heading"><div><h2>Mreader for Android</h2><p>Install on your phone or tablet and sign in with your Mreader account.</p></div><span class="connection-pill">Signed Android APK</span></div><div class="mobile-install-body"><div class="mobile-download-code">${code?code.svg:'<div class="qr-placeholder" aria-hidden="true">'+icon('downloads')+'</div><p>Your download code appears here.</p>'}</div><div class="mobile-install-instructions"><h3>Scan to download</h3><ol><li>Generate a QR code and scan it with your phone camera.</li><li>Open the HTTPS download page, then tap Download Android APK.</li><li>Install over your existing Mreader app to keep your data.</li></ol><p class="feature-note">Your phone only needs an internet connection. No GitHub sign-in, same Wi-Fi, or running desktop server is required. The link stays valid while the download page is published.</p>${featureState.mobileDownloadError?`<p class="notice" role="alert">${esc(featureState.mobileDownloadError)}</p>`:''}${code?`<label>Download page<input id="mobile-download-link" aria-label="Android APK download link" readonly value="${esc(code.url)}"></label><div class="button-row">${button('android-download-copy','Copy link','secondary')}${button('android-download-start','Refresh code','secondary')}</div>`:button('android-download-start',featureState.mobileDownloadBusy?'Generating…':'Generate download code','primary',featureState.mobileDownloadBusy?'disabled':'')}</div></div></section>`;
}
async function startMobileDownload() {
  if(featureState.mobileDownloadBusy)return;
  featureState.mobileDownloadBusy=true;featureState.mobileDownloadError='';render();
  try{featureState.mobileDownload=await api('mobile_download_start',{address:null});}
  catch(error){featureState.mobileDownloadError=String(error);}
  finally{featureState.mobileDownloadBusy=false;render();}
}
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-action]')?.dataset.action!=='android-download-copy')return;
  try{await navigator.clipboard.writeText(featureState.mobileDownload.url);toast('Download link copied');}catch{document.querySelector('#mobile-download-link')?.select();toast('Select and copy the download link');}
});

function sourceLabel(id) {
  if(id==='all')return 'All installed sources';
  if (!id) return "No source selected";
  if (id.startsWith("apk:")) return featureState.apk.installed.flatMap(e => e.extension.sources).find(s => "apk:"+s.id===id)?.name || "APK extension";
  if (id.startsWith("ext:"))
    return (
      featureState.extensions.find((e) => "ext:" + e.id === id)?.name ||
      id.slice(4)
    );
  return { local: "Local", mangadex: "MangaDex", komga: "Komga" }[id] || id;
}
function extensionOptions() {
  const ids=featureState.apk.installed.flatMap(e=>e.extension.sources.map(s=>'apk:'+s.id)).concat(featureState.extensions.map(e=>'ext:'+e.id));
  const pending=(state.source.startsWith('apk:')||state.source.startsWith('ext:'))&&!ids.includes(state.source)?`<option value="${esc(state.source)}" selected disabled>Synced source · waiting to prepare</option>`:'';
  return pending + featureState.apk.installed.flatMap(e => e.extension.sources).map(s => `<option value="apk:${esc(s.id)}" ${state.source==="apk:"+s.id?"selected":""}>${esc(s.name)} · ${esc(s.language)} (APK)</option>`).join("") + featureState.extensions
    .map(
      (e) =>
        `<option value="ext:${esc(e.id)}" ${state.source === "ext:" + e.id ? "selected" : ""}>${esc(e.name)} · ${esc(e.language)}</option>`,
    )
    .join("");
}

// A device-local queue keeps source load bounded and skips completed downloads.
const downloadJobs = new Map();
let downloadWorker = false;
function downloadQueueView() {
  if(!downloadJobs.size)return '';
  return `<section class="download-queue" aria-label="Download progress"><h2>Downloads on this device</h2><p class="sub">Downloads continue while minimized or with the phone screen off. Chapter files stay on this device.</p>${[...downloadJobs.values()].map(j=>{
    const active=j.active?{done:j.pageDone,total:j.pageTotal}:null,page=active?.total?`${active.done}/${active.total} pages`:j.active?'Preparing chapter…':'';
    const pct=j.total?Math.round((j.done+(active?.total?active.done/active.total:0))/j.total*100):100;
    return `<div class="download-job"><div><b>${esc(j.title)}</b><small>${j.done}/${j.total} chapters · ${j.paused?'Paused':j.pending.length||j.active?'Downloading':j.failed.length?'Finished with errors':'Ready offline'}${page?' · '+page:''}${j.failed.length?' · '+j.failed.length+' failed':''}</small></div><progress max="100" value="${pct}" aria-label="${esc(j.title)} download progress"></progress>${!j.paused&&(j.pending.length||j.active)?button('download-cancel','Stop queue','secondary',`data-id="${esc(j.id)}"`):''}${(j.paused&&j.pending.length||j.failed.length)&&!j.active?button('download-resume',j.paused?'Resume queue':'Retry missing','secondary',`data-id="${esc(j.id)}"`):''}${j.failed.length?`<small class="notice">${esc(j.failed[0].error)}</small>`:''}</div>`;
  }).join('')}</section>`;
}
function updateDownloadProgress() {
  const old=document.querySelectorAll('.download-queue');
  if(old.length)for(const el of old)el.outerHTML=downloadQueueView();
  else if(state.page==='Downloads')document.querySelector('.mobile-main,.main')?.insertAdjacentHTML('afterbegin',downloadQueueView());
  for(const el of document.querySelectorAll('[data-download-chapter]')) {
    const d=state.downloads.get(el.dataset.downloadChapter);
    if(d)el.textContent=d.total?`${d.done}/${d.total} pages`:'Preparing…';
  }
}
function applyDownloadJobs(jobs) {
  downloadJobs.clear();const active=new Set();
  for(const job of jobs){downloadJobs.set(job.id,job);if(job.active){active.add(job.active);state.downloads.set(job.active,{done:job.pageDone,total:job.pageTotal});}}
  for(const id of state.downloads.keys())if(!active.has(id))state.downloads.delete(id);
  updateDownloadProgress();
}
async function downloadAllChapters(id,unreadOnly=false,chapterIds=null) {
  let b=state.books.find(b=>b.id===id);if(!b||b.source==='local')return;
  if(!b.chapters.length){b=await api('chapters',{bookId:id,refresh:false});state.books=state.books.map(x=>x.id===id?b:x);}
  globalThis.MreaderChrome?.requestDownloadNotifications?.();
  applyDownloadJobs(await api('download_enqueue',{bookId:id,chapterIds,unreadOnly}));
  if(state.detail)renderDetails();toast('Downloads queued in the background. See Downloads for progress.');
}
async function loadDownloadQueue() {
  applyDownloadJobs(await api('download_queue'));
  await window.__TAURI__.event.listen('download-queue',async event=>{
    const before=[...downloadJobs.values()].reduce((n,j)=>n+j.done,0);
    applyDownloadJobs(event.payload);
    const after=event.payload.reduce((n,j)=>n+j.done,0);
    if(after!==before){applySnapshot(await api('snapshot'));render();if(state.detail){state.detail=bookById(state.detail.id);renderDetails();}}
  });
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&native)api('download_queue').then(jobs=>{applyDownloadJobs(jobs);return api('snapshot');}).then(snapshot=>{applySnapshot(snapshot);render();}).catch(toast);});
document.addEventListener('click',event=>{
  const t=event.target.closest('[data-action]');if(!t)return;
  if(t.dataset.action==='download-all'||t.dataset.action==='download-unread')downloadAllChapters(t.dataset.id,t.dataset.action==='download-unread').catch(toast);
  if(t.dataset.action==='download-cancel')api('download_stop',{bookId:t.dataset.id}).then(applyDownloadJobs).catch(toast);
  if(t.dataset.action==='download-resume'){const j=downloadJobs.get(t.dataset.id);if(j)downloadAllChapters(j.id,false,[...new Set([...j.pending,...j.failed.map(f=>f.id)])]).catch(toast);}
});
function inferEarlierRead(bookId,chapterId) {
  const b=state.books.find(b=>b.id===bookId);if(!b)return;
  const chapter=b.chapters.find(c=>c.id===chapterId),number=chapter?.number?.trim();
  if(!number||!Number.isFinite(Number(number)))return;
  for(const c of b.chapters){
    if(!c.number.trim()||!Number.isFinite(Number(c.number))||Number(c.number)>=Number(number))continue;
    const old=progressFor(bookId,c.id);if(old?.completed)continue;
    state.progress=state.progress.filter(p=>!(p.bookId===bookId&&p.chapterId===c.id));
    state.progress.push({...old,bookId,chapterId:c.id,page:old?.page??Math.max(0,c.pages-1),completed:true,updated:Date.now()-1});
  }
  indexProgress();
  b.tags=b.tags.filter(t=>!t.startsWith('mreader:update:')||!(t.slice(15)===chapterId||progressFor(bookId,t.slice(15))?.completed));
}

const browseCache=new Map(), browseVariants=new Map(), sourcePreviews=new Map();
let browseOffsets=new Map(),browseMore=new Set();
const titleKey=b=>b.title.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
function mergeBrowseBooks(books) {
  const grouped=new Map();browseVariants.clear();
  for(const book of books){const key=titleKey(book);const list=grouped.get(key)||[];if(!list.some(b=>b.id===book.id))list.push(book);grouped.set(key,list);}
  return [...grouped.values()].map(list=>{const primary=list.reduce((a,b)=>b.chapters.length>a.chapters.length?b:a);for(const b of list)browseVariants.set(b.id,list);return primary;});
}
async function cachedSourceSearch(source,query,offset,force=false) {
  const key=JSON.stringify([source,query,offset,state.settings.language]);const cached=browseCache.get(key);
  if(!force&&cached&&Date.now()-cached.at<300000)return cached.result;
  const result=await api('search_source',{source,query,offset});
  browseCache.set(key,{at:Date.now(),result});if(browseCache.size>40)browseCache.delete(browseCache.keys().next().value);
  return result;
}
async function searchAllSources(more,version,force=false) {
  const sources=userSources().filter(s=>!s.language||s.language==='all'||s.language===state.settings.language);
  if(!more){browseOffsets=new Map();browseMore=new Set(sources.map(s=>s.id));state.catalog=[];}
  const pending=sources.filter(s=>browseMore.has(s.id)),errors=[];
  let cursor=0,books=more?state.catalog.flatMap(b=>browseVariants.get(b.id)||[b]):[];
  const current=()=>version===searchVersion&&state.page==='Browse';
  await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
    while(cursor<pending.length){const source=pending[cursor++];
      try{
        const offset=browseOffsets.get(source.id)??(source.id.startsWith('apk:')?1:0);
        const r=await cachedSourceSearch(source.id,state.query,offset,force);if(!current())return;
        books.push(...r.books);browseOffsets.set(source.id,offset+(source.id.startsWith('apk:')?1:r.books.length));
        if(!r.books.length||r.total<=(source.id.startsWith('apk:')?r.books.length:offset+r.books.length))browseMore.delete(source.id);
        state.catalog=mergeBrowseBooks(books);state.total=state.catalog.length+(browseMore.size?1:0);render();
      }catch(e){if(!current())return;errors.push(source.name+': '+String(e));browseMore.delete(source.id);}
    }
  }));
  if(current()&&errors.length)state.error=errors.join(' · ');
}
async function compareBrowseSources(id) {
  const variants=browseVariants.get(id);if(!variants||variants.length<2)return null;
  const results=[];let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,variants.length)},async()=>{
    while(cursor<variants.length){const b=variants[cursor++];const cached=sourcePreviews.get(b.id);
      try{const value=cached&&Date.now()-cached.at<300000?cached.book:await api('preview_source_book',{book:b});sourcePreviews.set(b.id,{at:Date.now(),book:value});results.push(value);}
      catch{results.push({...b,previewFailed:true});}
    }
  }));
  const ranked=results.sort((a,b)=>Number(!!a.previewFailed)-Number(!!b.previewFailed)||b.chapters.length-a.chapters.length);
  for(const b of ranked)browseVariants.set(b.id,ranked);
  const primary=ranked[0];state.catalog=state.catalog.map(b=>b.id===id?primary:b);return primary;
}
function sourceAlternatives(book) {
  const variants=browseVariants.get(book.id);if(!variants||variants.length<2)return '';
  return `<div class="source-alternatives"><b>Available sources</b>${variants.map((b,i)=>button('source-variant',`${esc(sourceLabel(b.source))} · ${b.previewFailed?'Unavailable':b.chapters.length+' chapters'}${i===0?' · Primary':''}`,book.id===b.id?'primary':'secondary',`data-id="${esc(b.id)}"`)).join('')}</div>`;
}
document.addEventListener('click',event=>{
  const t=event.target.closest('[data-action="source-variant"]');if(!t)return;
  const b=[...browseVariants.values()].flat().find(b=>b.id===t.dataset.id);if(!b)return;
  if(!state.catalog.some(x=>x.id===b.id))state.catalog.push(b);
  state.detail=state.books.find(x=>x.id===b.id)||b;state.detailLoading=false;renderDetails();
});
function extensionIcon(extension) {
  let url='';try{const u=new URL(extension.iconUrl);if(u.protocol==='https:'&&!u.username&&!u.password)url=u.href;}catch{}
  return `<span class="extension-icon">${icon('book')}${url?`<img src="${esc(url)}" alt="${esc(extension.name)} icon" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
document.addEventListener('change',event=>{
  if(event.target.id==='migration-history'){featureState.migrationHistory=event.target.checked;render();return;}
  if(event.target.id==='manual-fingerprint'){
    const field=document.querySelector('#fingerprint-field');field.hidden=!event.target.checked;
    const input=field.querySelector('input');input.disabled=!event.target.checked;input.required=event.target.checked;
  }
});
function migrationView(){
 const p=featureState.migration;const importCount=p?(featureState.migrationHistory?p.manga.length:(p.libraryCount??p.manga.length)):0;
 return `<section class="feature-panel migration-panel"><div class="feature-heading"><div><h2>Migrate from Mihon / Tachiyomi</h2><p>Preview a backup locally before importing your manga, categories and reading progress.</p></div><label class="secondary">Choose backup<input id="migration-file" type="file" accept=".tachibk,.gz" hidden></label></div>${featureState.migrationBusy?'<p role="status">Reading backup…</p>':''}${featureState.migrationError?`<p class="notice" role="alert">${esc(featureState.migrationError)}</p>`:''}${p?`<div class="migration-summary"><b>${p.manga.length} manga</b><span>${p.libraryCount??p.manga.length} in library</span><span>${p.chapters} chapters</span><span>${p.read} read</span><span>${p.manga.reduce((n,m)=>n+m.inProgress,0)} in progress</span><span>${p.sources.length} source references</span></div>${p.warnings.map(w=>`<p class="feature-note">${esc(w)}</p>`).join('')}<details open><summary>Manga and reading status</summary><div class="migration-titles">${p.manga.map(m=>`<div><b>${esc(m.title)}</b><small>${m.inLibrary===false?"History only":"In Mihon library"}</small><small>${m.read} read · ${m.inProgress} in progress · ${m.unread} unread · ${esc(m.category)}</small><small>${esc(m.source)} · ${m.installed?'Source installed':'Source needs installing'}${m.existing?' · Merge with existing title':''}</small></div>`).join('')}</div></details><details><summary>Sources and extensions</summary>${p.sources.map(s=>`<p><b>${esc(s.name)}</b> · ${s.installed?'Installed':'Missing'}<small class="sub">${s.packages.length?' · Matching extension: '+s.packages.map(esc).join(', '):' · Install the matching extension in Sources'}</small></p>`).join('')}</details><details><summary>Repository references (${p.repositories.length})</summary>${p.repositories.map(r=>`<p><b>${esc(r.name)}</b><small class="data-path">${esc(r.url)}</small><small class="data-path">${esc(r.fingerprint)}</small></p>`).join('')}<p class="feature-note">Repositories and executable APKs are not automatically installed or trusted by migration.</p></details>${p.libraryCount<p.manga.length?`<label class="fingerprint-toggle"><input id="migration-history" type="checkbox" ${featureState.migrationHistory?"checked":""}> Also import ${p.manga.length-p.libraryCount} history-only titles</label>`:""}<div class="button-row">${button('migration-import',`Import ${importCount} manga and progress`,'primary',featureState.migrationBusy?'disabled':'')}${button('migration-cancel','Cancel','secondary')}</div><p class="sub">Import merges exact source/title identities and preserves existing downloads and completed chapters. It does not replace the whole library.</p>`:'<p class="feature-note">Supports .tachibk and .proto.gz backups. The file stays on this device; nothing is imported until you confirm the preview.</p>'}</section>`;
}
document.addEventListener('change',async event=>{
 if(event.target.id!=='migration-file'||!event.target.files?.[0])return;
 const file=event.target.files[0];featureState.migrationBusy=true;featureState.migrationError='';featureState.migration=null;featureState.migrationHistory=false;render();
 try{if(file.size>32*1024*1024)throw Error('Backup exceeds 32 MiB');featureState.migration=await window.__TAURI__.core.invoke('migration_preview',await file.arrayBuffer());}
 catch(e){featureState.migrationError=String(e);}finally{featureState.migrationBusy=false;render();}
});
document.addEventListener('click',async event=>{
 const t=event.target.closest('[data-action]');if(!t)return;
 if(t.dataset.action==='migration-cancel'){featureState.migration=null;featureState.migrationError='';render();}
 if(t.dataset.action==='migration-import'&&!featureState.migrationBusy){
   featureState.migrationBusy=true;render();
   try{const result=await api('migration_import',{confirmed:true,includeHistory:!!featureState.migrationHistory});applySnapshot(result.snapshot);featureState.migration=null;queueAccountSync();toast(`${result.imported} manga imported. Install missing sources in Settings to read them.`);}
   catch(e){featureState.migrationError=String(e);}finally{featureState.migrationBusy=false;render();}
 }
});
document.addEventListener('error',event=>{if(event.target.matches?.('.extension-icon img'))event.target.remove();},true);
function userSources() {
  return [...(state.settings.komgaUrl ? [{id:'komga',name:'Komga · personal server'}] : []),
    ...featureState.apk.installed.flatMap(e=>e.extension.sources.map(s=>({id:'apk:'+s.id,language:s.language,name:s.name+' · '+s.language+' (APK)'}))),
    ...featureState.extensions.map(e=>({id:'ext:'+e.id,language:e.language,name:e.name+' · '+e.language}))];
}
function ensureUserSource() {
  const sources=userSources();
  if(state.source==='all' && sources.length)return;
  if(!sources.some(s=>s.id===state.source)) {
    const pending=featureState.syncedSources.some(e=>e.kind==='apk' && state.source.startsWith('apk:'));
    if(!pending)state.source=sources.length>1?'all':sources[0]?.id || '';
  }
}
function sourceOptions() {
  ensureUserSource();
  const sources=userSources();
  if(sources.length>1)sources.unshift({id:'all',name:'All installed sources'});
  const pending=state.source && !sources.some(s=>s.id===state.source);
  return (pending?`<option value="${esc(state.source)}" selected disabled>Synced source · waiting to prepare</option>`:sources.length?'':'<option value="" selected>Add sources in Settings</option>') + sources.map(s=>`<option value="${esc(s.id)}" ${s.id===state.source?'selected':''}>${esc(s.name)}</option>`).join('');
}
function extensionView() {
  return sourceSyncView() + apkView() + `<section class="feature-panel"><div class="feature-heading"><div><h2>Native source extensions</h2><p>Portable JSON manifests. Install the same extension on desktop, phone, and tablet builds.</p></div><div class="button-row"><label class="secondary">Import manifest<input type="file" id="extension-file" accept=".json" hidden></label></div></div>${featureState.extensions.length ? featureState.extensions.map((e) => `<div class="extension-row"><div><b>${esc(e.name)}</b><small>${esc(e.id)} · v${esc(e.version)} · schema ${e.schemaVersion}</small><p>Network access: ${e.allowedHosts.map(esc).join(", ")}</p></div><div class="button-row">${button("extension-export", "Export", "secondary", `data-extension="${esc(e.id)}"`)}${button("extension-remove", "Uninstall", "secondary", `data-extension="${esc(e.id)}"`)}</div></div>`).join("") : '<p class="sub">No native extensions installed. Import your own manifest to add a source.</p>'}<p class="feature-note">Schema v1 supports JSON API sources. Add your own repository in the APK extension section above. Updating a manifest keeps its source and chapter IDs.</p></section>`;
}
function accountView() {
  const c = featureState.cloud;
  return `<section class="feature-panel"><div class="feature-heading"><div><h2>Account & cross-device progress</h2><p>${c.profile === "account" ? "Your account library is stored separately from this device’s guest library." : "Sign in to the same account on supported builds to share your library and reading progress."}</p></div><span class="connection-pill">${!c.configured ? "Not configured" : c.signedIn ? "Signed in" : "Ready to sign in"}</span></div>${c.signedIn ? `<p>${esc(c.email || "Your account")}</p><p class="sub">${featureState.syncing ? "Syncing…" : c.lastSync ? "Last synced " + new Date(c.lastSync).toLocaleString() : "Not synced yet"}${featureState.syncError ? " · " + esc(featureState.syncError) : ""}</p><div class="button-row">${button("cloud-sync", "Sync now", "primary")}${button("cloud-logout", "Sign out")}</div>` : !c.configured ? '<p class="notice">Managed account sync has not been configured for this build. Local reading and extensions work now; cross-device sync requires a managed project connection.</p>' : `<form id="account-form" class="account-form"><input name="email" type="email" required autocomplete="username" placeholder="Email" aria-label="Account email"><input name="password" type="password" minlength="8" required autocomplete="current-password" placeholder="Password" aria-label="Account password"><div class="button-row"><button type="submit" class="primary">Sign in</button><button type="submit" class="secondary" name="register" value="yes">Create account</button></div></form>`}<p class="feature-note">Sync shares metadata, extension definitions, favorites, and reading progress. It excludes passwords, local file paths, and manga bytes. Local files must be imported on each device. Use the same account on each device to share progress.</p></section>`;
}
function apkView() {
  const a=featureState.apk, q=featureState.apkQuery.trim().toLowerCase();
  const entries=a.repositories.flatMap(r => r.catalog.extensions.map(extension => ({repository:r.url,extension})));
  const filtered=entries.filter(({extension:e}) => q ? `${e.name} ${e.package} ${e.sources.map(s=>s.name+" "+s.language).join(" ")}`.toLowerCase().includes(q) : e.sources.some(s=>s.language==="en"));
  const installed=p=>a.installed.find(e=>e.extension.package===p);
  const layout=state.settings.apkLayout || "list";
  filtered.sort((a,b)=>Number(!!installed(b.extension.package))-Number(!!installed(a.extension.package)) || a.extension.name.localeCompare(b.extension.name));
  return `<section class="feature-panel apk-panel"><div class="feature-heading"><div><h2>APK source extensions</h2><p>Add a repository you choose, then install its extensions on this device. Your library and progress use the same source IDs on desktop and Android.</p></div></div><p class="feature-note">Extensions run third-party code. Install only from repositories you trust. Android runs APKs directly; desktop downloads a local compatibility runtime on first install (about 344 MB). No account hosting is required for extensions.</p><details><summary>Add extension repository</summary><form id="apk-repository-form" class="account-form"><input name="url" type="url" required placeholder="HTTPS repository or index.pb URL" aria-label="Extension repository URL"><label class="fingerprint-toggle"><input id="manual-fingerprint" type="checkbox"> Enter a signing fingerprint manually</label><label id="fingerprint-field" hidden>Repository signing fingerprint<input name="fingerprint" disabled pattern="[a-fA-F0-9]{64}" placeholder="Trusted signing fingerprint (64 hex characters)" aria-label="Repository signing fingerprint"></label><p class="feature-note">Known repositories use their saved signing fingerprint automatically. New repositories may require a fingerprint you verify.</p><button class="secondary" ${featureState.apkBusy?"disabled":""}>Add repository</button></form></details>${featureState.apkBusy?'<p role="status"><span class="spinner"></span> Preparing extension… First desktop install downloads the runtime.</p>':""}${featureState.apkError?`<p class="notice" role="alert">${esc(featureState.apkError)}</p>`:""}${entries.length?`<label class="apk-search-label">Find an extension<input id="apk-search" type="search" value="${esc(featureState.apkQuery)}" placeholder="Source name or language (default: English)"></label><div class="apk-display-controls" role="group" aria-label="Extension layout">${button("apk-layout","List",layout==="list"?"primary":"secondary",'data-layout="list" aria-pressed="'+(layout==="list")+'"')}${button("apk-layout","Stacked",layout==="stacked"?"primary":"secondary",'data-layout="stacked" aria-pressed="'+(layout==="stacked")+'"')}</div><p class="sub">${filtered.length} matching packages · ${a.installed.length} installed on this device</p><div class="apk-extension-results apk-layout-${layout}">${filtered.slice(0,60).map(({extension:e,repository})=>{const old=installed(e.package),up=old&&old.extension.versionCode<e.versionCode;return `<div class="extension-row"><div class="extension-identity">${extensionIcon(e)}<div><b>${esc(e.name)}</b><small>${esc(e.version)} · API ${esc(e.api)} · ${[...new Set(e.sources.map(s=>s.language))].map(esc).join(", ")}${e.contentWarning>=2?" · Mature content":""}</small><small>${esc(e.package)}</small></div></div><div class="button-row">${!old||up?button("apk-install",up?"Update":"Install","secondary",`data-package="${esc(e.package)}" data-repository="${esc(repository)}" ${featureState.apkBusy?"disabled":""}`):'<span class="connection-pill">Installed</span>'}${old?button("apk-remove",featureState.cloud.signedIn?"Remove everywhere":"Uninstall","secondary",`data-package="${esc(e.package)}" ${featureState.apkBusy?"disabled":""}`):""}</div></div>`}).join("")}</div>${filtered.length>60?'<p class="sub">Showing 60 results. Search to narrow the list.</p>':""}`:'<p class="sub">Add a repository to browse installable sources.</p>'}<p class="feature-note">Installed source choices sync with your account; each device prepares its own copy. Uninstalling preserves your library and progress. A source may require its own website account or verification; installing an extension does not grant access.</p></section>`;
}
async function apkAction(command,args) {
  if(featureState.apkBusy)return;
  featureState.apkBusy=true;featureState.apkError="";render();
  try {
    featureState.apk=await api(command,args);
    const local=await api('cloud_status');
    if(Array.isArray(local.sourceChoices))featureState.syncedSources=local.sourceChoices;
    if(local.preferredSource)state.source=local.preferredSource;
    featureState.sourceSyncErrors=[];
    ensureUserSource();
    releaseCoverCache();toast("Extension list updated");
  }
  catch(e){featureState.apkError=String(e);}
  finally {featureState.apkBusy=false;render();}
}
document.addEventListener("input", e=>{
  if(e.target.id!=="apk-search")return;
  const position=e.target.selectionStart;
  featureState.apkQuery=e.target.value;render();
  const input=document.getElementById("apk-search");input?.focus();input?.setSelectionRange(position,position);
});
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-action]");if(!t)return;
  if(t.dataset.action==="settings-section"){featureState.settingsTab=t.dataset.section;render();}
  if(t.dataset.action==="apk-layout"){try{applySnapshot(await api('save_settings',{settings:{...state.settings,apkLayout:t.dataset.layout,komgaPassword:''}}));render();}catch(error){toast(error);}}
  if(t.dataset.action==="android-download-start")await startMobileDownload();
  if(t.dataset.action==="android-download-stop"){try{await api('mobile_download_stop');clearTimeout(featureState.mobileDownloadTimer);featureState.mobileDownload=null;render();}catch(error){toast(error);}}
  if(t.dataset.action==="apk-install")await apkAction("apk_install",{repository:t.dataset.repository,package:t.dataset.package});
  if(t.dataset.action==="apk-remove")await apkAction("apk_remove",{package:t.dataset.package});
});
document.addEventListener("submit",async e=>{
  if(e.target.id!=="apk-repository-form")return;e.preventDefault();
  const form=new FormData(e.target);
  await apkAction("apk_repository",{url:form.get("url").trim(),trustKey:(form.get("fingerprint")||"").trim().toLowerCase()||null});
});
function releaseCoverCache() {
  for (const url of coverCache.values()) URL.revokeObjectURL(url);
  coverCache.clear();
  coverFailed.clear();
}
async function loadFeatures() {
  const [extensions, cloud, plan, apk] = await Promise.all([
    api("extension_list"),
    api("cloud_status"),
    api("verification_plan"),
    api("apk_state"),
  ]);
  featureState.extensions = extensions;
  featureState.apk = apk;
  featureState.cloud = cloud;
  if(cloud.preferredSource)state.source=cloud.preferredSource;
  featureState.syncedSources=cloud.sourceChoices||[];
  featureState.plan = plan;
  if (cloud.signedIn && !plan.enabled) await syncAccount(true);
  if (!plan.enabled) {
    setInterval(() => {
      if (featureState.cloud.signedIn && !state.busy) syncAccount(true);
    }, 30000);
  }
  return plan;
}
function queueAccountSync() {
  if (!featureState.cloud.signedIn || featureState.plan?.enabled) return;
  clearTimeout(featureState.syncTimer);
  featureState.syncTimer = setTimeout(() => syncAccount(true), 1500);
}
async function syncAccount(quiet = false) {
  if (featureState.syncing || state.busy) return;
  featureState.syncing = true;
  if(state.page==='Settings'&&!state.reader&&!document.activeElement?.matches('input,textarea,select'))render();
  try {
    const result = await api("cloud_sync");
    applySnapshot(result.snapshot);
    featureState.cloud = result.status;
    featureState.extensions = result.extensions;
    if(result.apk)featureState.apk=result.apk;
    featureState.syncedSources=result.sourceChoices||[];
    featureState.sourceSyncErrors=result.sourceSyncErrors||[];
    if(result.sourceChoicesChanged)queueAccountSync();
    const changed=result.preferredSource && result.preferredSource!==state.source;
    if(changed){state.source=result.preferredSource;state.catalog=[];state.total=0;searchVersion++;}
    ensureUserSource();
    featureState.syncError = "";
    if (
      !state.reader &&
      !document.activeElement?.matches("input,textarea,select")
    )
      render();
    if(changed && state.page==='Browse' && !state.reader)await searchSource();
    if (!quiet) toast("Account library and progress synced");
  } catch (e) {
    featureState.syncError = String(e);
    if (!quiet) toast(e);
  } finally {
    featureState.syncing = false;
    if(state.page==='Settings'&&!state.reader&&!document.activeElement?.matches('input,textarea,select'))render();
  }
}
function sourceSyncView() {
  if(!featureState.cloud.signedIn)return '';
  const pending=featureState.syncedSources.filter(e=>e.kind==='apk').map(e=>e.value).filter(e=>!featureState.apk.installed.some(old=>old.extension.package===e.package));
  return `<section class="feature-panel"><div class="feature-heading"><div><h2>Sources across devices</h2><p>Your installed source choices and active Browse source sync with this account. Website logins stay on each device.</p></div>${button('cloud-sync',featureState.syncing?'Syncing sources…':pending.length?'Retry source sync':'Sync sources','secondary',featureState.syncing?'disabled':'')}</div>${pending.map(e=>`<div class="extension-row"><div><b>${esc(e.name)}</b><small>Waiting to prepare on this device</small></div>${button('apk-remove','Remove from synced sources','secondary',`data-package="${esc(e.package)}"`)}</div>`).join('')}${featureState.sourceSyncErrors.map(error=>`<p class="notice" role="alert">${esc(error)}</p>`).join('')}</section>`;
}
async function refreshExtensions(list) {
  featureState.extensions = list;
  releaseCoverCache();
  if (
    state.source.startsWith("ext:") &&
    !list.some((e) => "ext:" + e.id === state.source)
  )
    state.source = "";
  ensureUserSource();
  render();
  queueAccountSync();
}
document.addEventListener("change", async (e) => {
  if (e.target.id !== "extension-file") return;
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 131072) throw Error("Manifest exceeds 128 KiB");
    const manifest = JSON.parse(await file.text());
    const layer = document.createElement("div");
    layer.className = "modal-backdrop";
    layer.id = "extension-review";
    layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-label="Review extension"><h2>Review ${esc(manifest.name || "extension")}</h2><p>Version ${esc(manifest.version)} · ${esc(manifest.id)}</p><p>Declared network hosts:</p><ul>${(manifest.allowedHosts || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul><p>Only install manifests from authors you trust.</p><div class="button-row">${button("extension-confirm", "Install manifest", "primary")}${button("extension-cancel", "Cancel")}</div></section>`;
    layer.pendingManifest = manifest;
    document.body.append(layer);
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-action]");
  if (!t) return;
  try {
    switch (t.dataset.action) {
      case "extension-confirm": {
        const layer = document.querySelector("#extension-review");
        await refreshExtensions(
          await api("extension_install", { manifest: layer.pendingManifest }),
        );
        layer.remove();
        toast("Native extension installed");
        break;
      }
      case "extension-cancel":
        document.querySelector("#extension-review")?.remove();
        break;
      case "extension-remove":
        await refreshExtensions(
          await api("extension_remove", { id: t.dataset.extension }),
        );
        toast("Extension removed. Your reading progress is preserved.");
        break;
      case "extension-export": {
        const ext = featureState.extensions.find(
          (e) => e.id === t.dataset.extension,
        );
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(ext, null, 2)], {
            type: "application/json",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = ext.id + ".mreader.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        break;
      }
      case "cloud-sync":
        await syncAccount();
        render();
        break;
      case "cloud-logout":
        if (state.busy) throw Error("Wait for the current import to finish");
        applySnapshot(await api("cloud_logout"));
        featureState.cloud = await api("cloud_status");
        featureState.extensions = await api("extension_list");
        releaseCoverCache();
        render();
        toast("Signed out. Guest library restored.");
        break;
    }
  } catch (err) {
    toast(err);
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id !== "account-form") return;
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    {
      if (state.busy) throw Error("Wait for the current import to finish");
      const result = await api("cloud_auth", {
        email: form.get("email"),
        password: form.get("password"),
        register: e.submitter?.name === "register",
      });
      e.target.reset();
      featureState.cloud = result.status;
      applySnapshot(result.snapshot);
      featureState.extensions = await api("extension_list");
      releaseCoverCache();
      render();
      if (result.confirmationRequired)
        toast("Check your email to confirm the account, then sign in.");
      else await syncAccount();
    }
  } catch (err) {
    toast(err);
  }
});

async function runVerification(plan) {
  const checks = [];
  const check = (name, ok, details = {}) => {
    if (!ok) throw Error(name + " failed");
    checks.push({ name, ok, ...details });
  };
  let report;
  try {
    if (plan.display === "2") check(
      "display-two",
      window.screen.availLeft >= 1920 || window.screenX >= 1920,
      { screenX: window.screenX, screenY: window.screenY },
    );
    else check("virtual-display", window.screen.width > 0);
    const imported = await api("import_paths", { paths: plan.files });
    check(
      "local-import",
      imported.imported === plan.files.length && imported.errors.length === 0,
    );
    applySnapshot(imported.snapshot);
    render();
    const archive = state.books.find((b) =>
      b.path.toLowerCase().endsWith(".cbz"),
    );
    check("archive-index", archive?.chapters[0].pages === 3);
    await openReader(archive.id, archive.chapters[0].id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "local-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    await turnPage(1);
    await document.querySelector(".reading-page").decode();
    check("local-page-navigation", state.reader.page === 1);
    closeReader();
    const pdf = state.books.find((b) => b.path.toLowerCase().endsWith(".pdf"));
    const pdfBytes = new Uint8Array(
      await api("page_data", {
        bookId: pdf.id,
        chapterId: pdf.chapters[0].id,
        page: 0,
      }),
    );
    check(
      "pdf-import",
      String.fromCharCode(...pdfBytes.slice(0, 5)) === "%PDF-",
    );
    const pdfUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    const pdfDocument = await openMobilePdf(pdfUrl);
    check("mobile-pdf-page-count", pdfDocument.numPages > 0);
    await api("save_progress", { bookId: pdf.id, chapterId: pdf.chapters[0].id, page: 0, completed: false, totalPages: pdfDocument.numPages });
    const countedPdf = (await api("snapshot")).books.find(book => book.id === pdf.id);
    check("mobile-pdf-count-persisted", countedPdf.chapters[0].pages === pdfDocument.numPages);
    let invalidCountRejected = false;
    try {
      await api("save_progress", { bookId: archive.id, chapterId: archive.chapters[0].id, page: 0, completed: false, totalPages: 999 });
    } catch { invalidCountRejected = true; }
    check("image-page-count-protected", invalidCountRejected);
    const pdfCanvas = document.createElement("canvas");
    pdfCanvas.style.position = "fixed";
    pdfCanvas.style.left = "-10000px";
    document.body.append(pdfCanvas);
    await renderMobilePdf({ pdfDocument, page: 0 }, pdfCanvas);
    check("mobile-pdf-canvas-render", pdfCanvas.width > 0 && pdfCanvas.height > 0);
    pdfCanvas.remove();
    await pdfDocument.destroy();
    URL.revokeObjectURL(pdfUrl);
    if (plan.offline) {
      await openReader(pdf.id, pdf.chapters[0].id, 0);
      check("pdf-reader-uses-canvas", !!state.reader?.pdfDocument && !!document.querySelector("canvas.reading-page"));
      await turnPage(1);
      check("pdf-reader-progress", (await api("snapshot")).progress.some(progress => progress.bookId === pdf.id && progress.page === 1));
      closeReader();
      check("pdf-library-page-count", [...document.querySelectorAll(".continue-card")].some(card => card.querySelector('[data-action="read"]')?.dataset.id === pdf.id && card.textContent.includes(`Page 2 of ${countedPdf.chapters[0].pages}`)));
      // Keep the verified interface visible briefly for the CI screenshot.
      await new Promise(resolve => setTimeout(resolve, 3000));
      await api("verification_finish", { report: { ok: true, checks, cloudConfigured: featureState.cloud.configured, completedAt: new Date().toISOString() } });
      return;
    }
    const catalog = await api("search_source", {
      source: "mangadex",
      query: "Everyday Host",
      offset: 0,
    });
    const remote = catalog.books[0];
    check("live-catalog", !!remote);
    applySnapshot(await api("add_book", { book: remote }));
    const remoteBook = await api("chapters", {
      bookId: remote.id,
      refresh: false,
    });
    state.books = state.books.map((b) =>
      b.id === remoteBook.id ? remoteBook : b,
    );
    state.page = "Library";
    render();
    const coverBytes = await api("cover_data", { book: remoteBook });
    const imageUrl = URL.createObjectURL(
      new Blob([coverBytes], { type: "image/jpeg" }),
    );
    coverCache.set(remoteBook.id, imageUrl);
    render();
    const coverElement = [...document.querySelectorAll(".cover-art")].find(
      (el) => el.tagName === "IMG" && el.src === imageUrl,
    );
    await coverElement.decode();
    check("cover-fix-native-and-webview", coverElement.naturalWidth > 0, {
      width: coverElement.naturalWidth,
      height: coverElement.naturalHeight,
      bytes: coverBytes.byteLength,
    });
    const chapter =
      remoteBook.chapters.find((c) => c.pages > 0 && c.pages <= 12) ||
      remoteBook.chapters[0];
    await openReader(remoteBook.id, chapter.id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "live-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    await turnPage(1);
    await document.querySelector(".reading-page").decode();
    closeReader();
    check(
      "progress-saved",
      (await api("snapshot")).progress.some(
        (p) => p.bookId === remoteBook.id && p.page === 1,
      ),
    );
    featureState.extensions = await api("extension_example");
    const extCatalog = await api("search_source", {
      source: "ext:org.mreader.mangadex",
      query: "Everyday Host",
      offset: 0,
    });
    check("native-extension-search", extCatalog.books.length > 0);
    applySnapshot(await api("add_book", { book: extCatalog.books[0] }));
    const extBook = await api("chapters", {
      bookId: extCatalog.books[0].id,
      refresh: false,
    });
    state.books = state.books.map((b) => (b.id === extBook.id ? extBook : b));
    check("native-extension-chapters", extBook.chapters.length > 0);
    const extChapter =
      extBook.chapters.find((c) => c.pages > 0 && c.pages <= 12) ||
      extBook.chapters[0];
    await openReader(extBook.id, extChapter.id, 0);
    await document.querySelector(".reading-page").decode();
    check(
      "native-extension-page-render",
      document.querySelector(".reading-page").naturalWidth > 0,
    );
    closeReader();
    const offline = await api("download_chapter", {
      bookId: remoteBook.id,
      chapterId: chapter.id,
    });
    check(
      "chapter-download",
      offline.chapters.some((c) => c.id === chapter.id && c.downloaded),
    );
    const bytes = await api("page_data", {
      bookId: remoteBook.id,
      chapterId: chapter.id,
      page: 0,
    });
    check("offline-page-read", bytes.byteLength > 1000);
    report = {
      ok: true,
      checks,
      cloudConfigured: featureState.cloud.configured,
      completedAt: new Date().toISOString(),
    };
  } catch (e) {
    report = {
      ok: false,
      checks,
      error: String(e),
      completedAt: new Date().toISOString(),
    };
  }
  await api("verification_finish", { report });
}
