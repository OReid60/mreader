// Native extension management and managed account sync. No credentials enter page storage.
const featureState = {
  settingsTab: "general",
  appVersion: null,
  browseSourceChosen: false,
  sourceVerification: null,
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
  const mobile=typeof useMobileLayout==='function' && useMobileLayout();
  const sections=[['general','General'],['account','Account & sync'],['sources','Sources'],...(!mobile?[['mobile','Mobile app']]:[]),['storage','Files & backup']];
  const sourceIssues=skippedSources().length;
  const selected=sections.some(([id])=>id===featureState.settingsTab)?featureState.settingsTab:'general';
  const formStart=content.indexOf('<form id="settings-form">');
  const formEnd=content.indexOf('</form>',formStart)+7;
  const panels={general:()=>content.slice(formStart,formEnd),account:accountView,sources:extensionView,mobile:mobileInstallView,storage:()=>filesBackupView(content.slice(formEnd))};
  return `${mobile?'':'<div class="heading"><div><h1>Settings</h1><p class="sub">Personalize your reader, manage sources, and connect your devices.</p></div></div>'}<div class="settings-workspace"><nav class="settings-navigation" role="tablist" aria-label="Settings sections">${sections.map(([id,label])=>`<button role="tab" id="settings-tab-${id}" aria-controls="settings-panel" aria-selected="${selected===id}" class="${selected===id?'active':''}" data-action="settings-section" data-section="${id}">${label}${id==='sources'&&sourceIssues?`<span class="settings-issue-badge" aria-hidden="true">${sourceIssues}</span>`:''}</button>`).join('')}</nav><section id="settings-panel" class="settings-panel" role="tabpanel" aria-labelledby="settings-tab-${selected}">${panels[selected]()}</section></div>`;
}
function filesBackupView(content){
 const mobile=typeof useMobileLayout==='function'&&useMobileLayout();
 const layout=!mobile&&state.settings.filesLayout==='stacked'?'stacked':'list';
 return `<div class="files-view-toolbar"><h2>Files & backup</h2>${mobile?'':`<div class="button-row">${['list','stacked'].map(value=>button('files-layout',value==='list'?'List':'Stacked','secondary',`data-layout="${value}" aria-pressed="${layout===value}"`)).join('')}</div>`}</div><div class="files-layout files-layout-${layout}">${content}</div>`;
}
function backupMigrationView(){
 return `<section class="feature-panel backup-migration-panel"><div class="feature-heading"><div><h2>Backups & migration</h2><p>Save your Mreader library or bring your library from another reader.</p></div></div><div class="settings-row backup-controls"><div><h3>Mreader backup</h3><p>Includes metadata, reading progress, preferences and custom cover art. Manga files and passwords are excluded.</p><p>Restore merges with your library. Downloads may need downloading again.</p></div><div class="button-row">${button('export','Export backup')}${button('restore','Restore backup')}</div></div>${migrationView(true)}</section>`;
}
function canonicalRepositoryUrl(value){
 try{return new URL(value.trim()).href.replace(/\/$/,'');}catch{return value.trim().replace(/\/$/,'');}
}
function installedRepositoryView(){
 const repos=featureState.apk.repositories;
 return `<section class="repository-list" aria-label="Added extension repositories"><h3>Added extension lists</h3>${repos.length?repos.map(r=>`<div class="repository-row"><div><b>${esc(r.catalog.name||'Extension repository')}</b><small>${r.catalog.extensions.length} extensions</small></div><span class="connection-pill">Added</span>${button('repository-refresh','Refresh list','secondary',`data-repository="${esc(r.url)}"`)}</div>`).join(''):'<p class="sub">No extension lists added yet.</p>'}</section>`;
}
function mobileInstallView() {
 const code=featureState.mobileDownload,expired=!!code&&Date.now()>=code.expiresAt;
 const left=code?Math.max(0,Math.ceil((code.expiresAt-Date.now())/1000)):0;
 return `<section class="feature-panel mobile-install"><div class="feature-heading"><div><h2>Mreader for Android</h2><p>Download the signed APK bundled with this desktop app.</p></div><span class="connection-pill">Local transfer · 5 minutes</span></div><div class="mobile-install-body"><div class="mobile-download-code">${code&&!expired?code.svg:'<div class="qr-placeholder">'+icon('downloads')+'</div><p>'+(expired?'Download code expired. Generate a new code.':'Your download code appears here.')+'</p>'}</div><div class="mobile-install-instructions"><h3>Scan to download</h3><ol><li>Connect your phone and desktop to the same Wi-Fi or local network.</li><li>Generate a code and scan it with your phone camera.</li><li>Tap Download APK. Install over the existing app to keep your data.</li></ol><p class="feature-note">The APK is served directly from this computer, with no public hosting address. Keep Mreader open. The link expires automatically after five minutes. Allow Mreader on your private network if Windows asks.</p>${featureState.mobileDownloadError?`<p class="notice" role="alert">${esc(featureState.mobileDownloadError)}</p>`:''}${code&&!expired?`<p data-download-countdown role="status">Expires in ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}</p><label>Local download link<a id="mobile-download-link" class="mobile-download-address" href="${esc(code.url)}" target="_blank" rel="noopener noreferrer">${esc(code.url)}</a></label>${code.addresses?.length>1?`<label>Desktop network address<select id="mobile-download-address">${code.addresses.map(a=>`<option value="${esc(a)}" ${a===code.address?'selected':''}>${esc(a)}</option>`).join('')}</select></label>`:''}<div class="button-row">${button('android-download-copy','Copy link','secondary')}${button('android-download-start','Regenerate download code','secondary')}${button('android-download-stop','Stop sharing','secondary')}</div>`:button('android-download-start',featureState.mobileDownloadBusy?'Generating…':expired?'Regenerate download code':'Generate download code','primary',featureState.mobileDownloadBusy?'disabled':'')}</div></div></section>`;
}
function tickMobileDownload(){
 const code=featureState.mobileDownload;if(!code)return;
 const left=Math.max(0,Math.ceil((code.expiresAt-Date.now())/1000));
 const label=document.querySelector('[data-download-countdown]');if(label)label.textContent=`Expires in ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
 if(!left){clearInterval(featureState.mobileDownloadTimer);if(!state.reader&&['Settings','More'].includes(state.page))render();}
}
async function startMobileDownload(address=null,regenerate=true) {
 if(featureState.mobileDownloadBusy)return;
 featureState.mobileDownloadBusy=true;featureState.mobileDownloadError='';render();
 try{if(regenerate&&featureState.mobileDownload)await api('mobile_download_stop');featureState.mobileDownload=await api('mobile_download_start',{address});clearInterval(featureState.mobileDownloadTimer);featureState.mobileDownloadTimer=setInterval(tickMobileDownload,1000);}
 catch(error){featureState.mobileDownloadError=String(error);}
 finally{featureState.mobileDownloadBusy=false;render();}
}
document.addEventListener('change',event=>{if(event.target.id==='mobile-download-address')void startMobileDownload(event.target.value,false);});

document.addEventListener('click',async event=>{
  if(event.target.closest('[data-action]')?.dataset.action!=='android-download-copy')return;
  try{await navigator.clipboard.writeText(featureState.mobileDownload.url);toast('Download link copied');}catch{toast('Clipboard unavailable. Scan the QR code to open the download page.');}
});

const sourceRepair={running:false,attempted:new Set(),errors:new Map()};
function mangaExtensionInfo(book){
 if(!book?.source?.startsWith('apk:')){
  if(book?.source?.startsWith('ext:')){const e=featureState.extensions.find(e=>'ext:'+e.id===book.source);return {name:e?.name||book.source.slice(4),installed:!!e,kind:'Native extension'};}
  return {name:sourceLabel(book?.source),installed:true,kind:book?.source==='local'?'Local files':'Built-in source'};
 }
 const id=book.source.slice(4),installed=featureState.apk.installed.find(e=>e.extension.sources.some(s=>String(s.id)===id));
 const candidates=featureState.apk.repositories.flatMap(r=>r.catalog.extensions.filter(e=>e.sources.some(s=>String(s.id)===id)));
 const known=installed?.extension||candidates[0],source=known?.sources.find(s=>String(s.id)===id);
 const remembered=book.tags?.find(t=>t.startsWith('mreader:source-name:'))?.slice('mreader:source-name:'.length);
 return {name:known?.name||remembered||'Unidentified extension',sourceName:source?.name||remembered||'',language:source?.language||'',installed:!!installed,kind:'APK extension',flagged:!!installed&&(state.settings.flaggedExtensions||[]).includes('apk:'+installed.extension.package)};
}
function mangaCoverWarningView(book){
 const info=mangaExtensionInfo(book),missing=!info.installed,hidden=(state.settings.dismissedCoverWarnings||[]).includes(book.id);
 const message=missing?(sourceRepair.running?'Checking and installing the associated extension…':sourceRepair.errors.get(book.source)||'This manga needs its source extension to load chapters and cover art. Add its repository in Settings → Sources; Mreader will check and install the match.'):(coverFailed.has(book.id)&&!hidden?'Cover art could not load. The extension is installed; the source may be offline, blocked, outdated, or have no cover.':'');
 const saved=state.books.some(b=>b.id===book.id),hint=saved&&!coverCache.has(book.id)&&!book.customCover?.jpeg&&state.settings.showCoverSearch!==false?'<p class="cover-art-help">You can add your own cover art using <strong>Search cover images</strong>.</p>':'';
 return `<div class="cover-art-warning">${message?`<p class="notice" role="status">${esc(message)}${!missing?button('cover-warning-hide','Hide warning','secondary',`data-id="${esc(book.id)}"`):''}</p>`:''}${!missing&&hidden&&coverFailed.has(book.id)?button('cover-warning-show','Show cover warning','secondary',`data-id="${esc(book.id)}"`):''}${hint}</div>`;
}
function mangaSourceView(book){
 const info=mangaExtensionInfo(book),missing=!info.installed;
 const name=esc(info.name)+(info.sourceName&&info.sourceName!==info.name?' · '+esc(info.sourceName):'');
 const website=book.source.startsWith('apk:')&&!missing?button('source-verify',name,'source-website-link',`data-source-id="${esc(book.source)}" aria-label="Open source website for ${esc(book.title)}" title="Open source website and verify in the app"`):name;
 return `<section class="manga-source-info"><p>${website}${info.language?' · '+esc(info.language):''}</p><small>${missing?'Extension needed':'Installed'}${info.flagged?' · Flagged as not working':''}</small>${mangaCoverWarningView(book)}${sourceVerificationPreview(book.source)}${missing?`<div class="button-row">${book.source.startsWith('apk:')?button('repair-book-source',sourceRepair.running?'Checking extension…':'Check / install extension','secondary',`data-id="${esc(book.id)}" ${sourceRepair.running?'disabled':''}`):''}${button('source-settings','Open Sources settings','secondary')}</div>`:''}</section>`;
}
async function repairMissingBookExtensions(retry=false,onlyId=null){
 if(sourceRepair.running)return;
 const missing=state.books.filter(b=>(!onlyId||b.id===onlyId)&&b.source.startsWith('apk:')&&!mangaExtensionInfo(b).installed&&(retry||!sourceRepair.attempted.has(b.source)));
 if(!missing.length)return;
 sourceRepair.running=true;for(const b of missing)sourceRepair.attempted.add(b.source);
 try{const failures=await prepareMigratedExtensions(missing.map(b=>b.id));for(const b of missing){if(failures.has(b.source))sourceRepair.errors.set(b.source,failures.get(b.source));else{sourceRepair.errors.delete(b.source);coverFailed.delete(b.id);}}
 }catch(error){for(const b of missing)sourceRepair.errors.set(b.source,String(error));}
 finally{sourceRepair.running=false;if(!state.reader&&!document.activeElement?.matches('input,textarea,select')){render();if(state.detail)renderDetails();}loadCovers();}
}
document.addEventListener('click',event=>{const t=event.target.closest('[data-action]');if(t?.dataset.action==='repair-book-source')void repairMissingBookExtensions(true,t.dataset.id);if(t?.dataset.action==='source-settings'){closeDetail();featureState.settingsTab='sources';navigate('Settings');}});
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
    const book=state.books.find(b=>b.id===j.id),saved=book?.chapters.filter(c=>c.downloaded&&c.path).length||0;
    const jobSource=book?.source||j.id.split(':').slice(0,j.id.startsWith('apk:')||j.id.startsWith('ext:')?2:1).join(':');
    const status=j.paused?'Paused':j.pending.length||j.active?'Downloading':j.failed.length?'Finished with errors':!book?'Title removed from library':saved?'Ready offline': 'No saved chapters on this device';
    const pct=j.total?Math.round((j.done+(active?.total?active.done/active.total:0))/j.total*100):100;
    return `<div class="download-job"><div><b>${esc(j.title)}</b><small>${j.done}/${j.total} chapters · ${status} · ${esc(sourceLabel(jobSource))}${page?' · '+page:''}${j.failed.length?' · '+j.failed.length+' failed':''}</small></div><progress max="100" value="${pct}" aria-label="${esc(j.title)} download progress"></progress>${!j.paused&&(j.pending.length||j.active)?button('download-cancel','Stop queue','secondary',`data-id="${esc(j.id)}"`):''}${(j.paused&&j.pending.length||j.failed.length)&&!j.active?button('download-resume',j.paused?'Resume queue':'Retry missing','secondary',`data-id="${esc(j.id)}"`):''}${j.failed.length?`<small class="notice">${esc(j.failed[0].error)}</small>`:''}</div>`;
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
const browseRequests=new Map(),browseViews=new Map(),browseFailures=new Map();
function browseScope(){return JSON.stringify([state.dataDir,state.settings.language,featureState.cloud.profile,featureState.cloud.email,featureState.apk.installed.map(e=>[e.extension.package,e.extension.versionCode]),featureState.extensions.map(e=>[e.id,e.version])]);}
function saveBrowseView(){if(state.loading||state.catalog.length>500)return;browseViews.set(browseScope(),{at:Date.now(),source:state.source,query:state.query,catalog:state.catalog,total:state.total,apkPage:state.apkPage,offsets:[...browseOffsets],more:[...browseMore],scroll:window.scrollY||0,failures:[...browseFailures],skips:sourceSkipToken()});if(browseViews.size>6)browseViews.delete(browseViews.keys().next().value);}
function restoreBrowseView(){const v=browseViews.get(browseScope());if(!v||Date.now()-v.at>300000||v.source!==state.source||v.skips!==sourceSkipToken())return false;Object.assign(state,{query:v.query,catalog:v.catalog,total:v.total,apkPage:v.apkPage,catalogContext:JSON.stringify([v.source,v.query,browseScope()])});browseOffsets=new Map(v.offsets);browseMore=new Set(v.more);browseFailures.clear();for(const [id,issue] of v.failures||[])browseFailures.set(id,issue);render();globalThis.requestAnimationFrame?.(()=>window.scrollTo?.(0,v.scroll));return true;}
let browseOffsets=new Map(),browseMore=new Set();
let sourceSkipScope='',sourceSkipRecords=Object.create(null),sourceSkipSaveFailed=false;
const sourceChecks=new Set();
function sourceSkipKey(){return 'mreader:source-skips:'+JSON.stringify([state.dataDir,featureState.cloud.profile,featureState.cloud.email]);}
function sourceSkipData(){
 const key=sourceSkipKey();if(key!==sourceSkipScope){sourceSkipScope=key;sourceSkipSaveFailed=false;try{sourceSkipRecords=Object.assign(Object.create(null),JSON.parse(localStorage.getItem(key)||'{}'));}catch{sourceSkipRecords=Object.create(null);}}
 return sourceSkipRecords;
}
function sourceVersion(id){
 if(id.startsWith('apk:')){const e=featureState.apk.installed.find(e=>e.extension.sources.some(s=>'apk:'+s.id===id));return e?String(e.extension.versionCode??e.extension.version??''):null;}
 if(id.startsWith('ext:'))return featureState.extensions.find(e=>'ext:'+e.id===id)?.version??null;
 return id==='komga'&&state.settings.komgaUrl?'komga':null;
}
function sourceSkipStatus(id){
 const item=sourceSkipData()[id];
 return item&&item.version===sourceVersion(id)&&typeof item.retryAfter==='number'&&(item.retryAfter===0||item.retryAfter>Date.now())?item:null;
}
function sourceIsSkipped(id){return !!sourceSkipStatus(id);}
function skippedSources(){return userSources().filter(s=>sourceIsSkipped(s.id));}
function allSourcesSkipped(){const sources=state.page==='Browse'&&state.source==='all'?userSources():[];return sources.length>0&&sources.every(s=>sourceIsSkipped(s.id));}
function sourceSkipToken(){return skippedSources().map(s=>s.id).sort().join('|');}
function saveSourceSkips(){
 try{localStorage.setItem(sourceSkipScope,JSON.stringify(sourceSkipRecords));sourceSkipSaveFailed=false;}
 catch{if(!sourceSkipSaveFailed)toast('Source skip settings could not be saved. They may reset after restart.');sourceSkipSaveFailed=true;}
 browseViews.clear();
}
function clearSourceSkip(id){const records=sourceSkipData();if(Object.hasOwn(records,id)){delete records[id];saveSourceSkips();}}
function browseFailureKind(error){
 const text=String(error);
 if(/not available in (?:your|this) (?:country|region)|geo.?restrict/i.test(text))return 'region';
 if(/browser verification|cloudflare|captcha|browser challenge/i.test(text))return 'verification';
 if(/UnknownHost|EAI_NODATA|network|failed to fetch|connection|offline|DNS|timeout|timed out|\b(?:429|5\d\d)\b/i.test(text))return 'network';
 return 'source';
}
function skipFailedSource(source,error){
 const kind=browseFailureKind(error);if(kind==='network'&&navigator.onLine===false)return;
 const version=sourceVersion(source.id);if(version===null)return;
 const records=sourceSkipData();records[source.id]={version,kind,reason:browseProblemMessage(error),checkedAt:Date.now(),retryAfter:kind==='network'?Date.now()+300000:0};saveSourceSkips();
}
const sourceDisclosureStates=new Map();
function sourceDisclosureOpen(name,fallback=false){return sourceDisclosureStates.get(JSON.stringify([sourceSkipKey(),name]))??fallback;}
document.addEventListener('toggle',event=>{
 const node=event.target;
 const name=node.matches?.('.source-manager-skips')?'skips':node.matches?.('.source-skip-help')?'help':null;
 if(!name||!node.isConnected)return;
 const key=JSON.stringify([sourceSkipKey(),name]);
 if(!sourceDisclosureStates.has(key)&&sourceDisclosureStates.size>=32)sourceDisclosureStates.delete(sourceDisclosureStates.keys().next().value);
 sourceDisclosureStates.set(key,node.open);
},true);
function sourceSkipActions(id){return `${id.startsWith('apk:')&&sourceSkipStatus(id)?.kind!=='region'?button('source-verify','Verify in browser','secondary',`data-source-id="${esc(id)}" ${state.loading||sourceChecks.has(id)?'disabled':''}`):''}${button('source-check',sourceChecks.has(id)?'Checking…':'Retry source','secondary',`data-source-id="${esc(id)}" ${state.loading||sourceChecks.has(id)?'disabled':''}`)}${sourceIsSkipped(id)?button('source-enable','Re-enable','secondary',`data-source-id="${esc(id)}" ${state.loading||sourceChecks.has(id)?'disabled':''}`):''}`;}
function sourceSkipRow(source){
 const item=sourceSkipStatus(source.id);if(!item)return '';
 const status=item.retryAfter?`Skipped temporarily · eligible again in ${Math.max(1,Math.ceil((item.retryAfter-Date.now())/60000))} min`:'Skipped in All until you retry or re-enable it';
 return `<div class="browse-source-issue" data-source-issue="${esc(item.kind)}"><b>${esc(source.name)}</b><span class="source-issue-tag">${({region:'Region restricted',verification:'Verification needed',network:'Connection issue',source:'Source issue'})[item.kind]||'Needs attention'}</span><small>${esc(item.reason)}</small><small>${esc(item.kind==='region'?'Publisher country restriction; reader fixes cannot remove it.':status)}</small><div class="button-row">${sourceSkipActions(source.id)}</div></div>`;
}
function sourceAvailabilityView(){
 const skipped=skippedSources(),session=featureState.sourceVerification;
 return `<section class="feature-panel source-availability-panel ${skipped.length?'has-source-issues':''}"><div class="feature-heading"><div><h2>Source manager</h2><p>Choose the sources used by Browse and manage sources skipped in All.</p></div></div><label class="source-manager-filter">Browse source<select id="source-manager-select">${sourceOptions()}</select></label><p class="sub">All combines working installed sources. Individual selection checks that source directly. The selection applies to this session.</p>${session?`<div class="notice" role="status"><b>Browser verification opened</b><p>Complete verification in the source browser, then return here. This is a user-controlled website session; some sites may still refuse it.</p><div class="button-row">${button('source-verify-finish','Finish verification and retry','primary')}${button('source-verify-cancel','Cancel','secondary')}</div></div>`:''}<details class="source-manager-skips" ${sourceDisclosureOpen('skips',skipped.length>0)?'open':''}><summary>${skipped.length} ${skipped.length===1?'source':'sources'} skipped in All</summary><p>Sources stay installed. Retry checks availability again.</p><details class="source-skip-help" ${sourceDisclosureOpen('help')?'open':''}><summary>How skipping works</summary><p>Network failures pause for five minutes. Other failures stay skipped until retry, re-enabling, or an extension update. Browser verification and reader fixes do not remove publisher country restrictions.</p></details>${sourceSkipSaveFailed?'<p class="notice">Skip settings could not be saved and may reset after restart.</p>':''}${skipped.length?`<div class="browse-source-issues">${skipped.map(sourceSkipRow).join('')}</div>`:'<p class="sub">No sources are currently skipped.</p>'}</details></section>`;
}
async function checkSourceAvailability(id){
 if(sourceChecks.has(id))return;const source=userSources().find(s=>s.id===id);if(!source)return;
 const scope=sourceSkipKey(),version=sourceVersion(id);sourceChecks.add(id);render();
 try{await cachedSourceSearch(id,'',id.startsWith('apk:')?1:0,true);if(scope!==sourceSkipKey()||version!==sourceVersion(id))return;clearSourceSkip(id);browseFailures.delete(id);toast('Source is available and enabled in All.');}
 catch(error){if(scope!==sourceSkipKey()||version!==sourceVersion(id))return;skipFailedSource(source,error);toast(browseProblemMessage(error));}
 finally{sourceChecks.delete(id);render();if(state.detail)renderDetails();}
}

const titleKey=b=>b.title.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
function mergeBrowseBooks(books) {
  const grouped=new Map();browseVariants.clear();
  for(const book of books){const key=titleKey(book);const list=grouped.get(key)||[];if(!list.some(b=>b.id===book.id))list.push(book);grouped.set(key,list);}
  return [...grouped.values()].map(list=>{const primary=list.reduce((a,b)=>b.chapters.length>a.chapters.length?b:a);for(const b of list)browseVariants.set(b.id,list);return primary;});
}
async function cachedSourceSearch(source,query,offset,force=false) {
  const key=JSON.stringify([browseScope(),source,query,offset,state.settings.language]);let cached=browseCache.get(key);
  if(!cached){try{cached=JSON.parse(localStorage.getItem('mreader:browse:'+key)||'null');}catch{}}
  if(!force&&cached&&Date.now()-cached.at<300000)return cached.result;
  if(browseRequests.has(key))return browseRequests.get(key);
  const pending=(async()=>{const result=await api('search_source',{source,query,offset});
  // Browse may have refreshed a stale extension thumbnail. Let the exact saved
  // entries retry instead of keeping a transient failure for the whole session.
  for(const book of result.books)coverFailed.delete(book.id);
  browseCache.set(key,{at:Date.now(),result});if(browseCache.size>40)browseCache.delete(browseCache.keys().next().value);
  try{const value=JSON.stringify({at:Date.now(),result});if(value.length<128000){const keys=Object.keys(localStorage).filter(k=>k.startsWith('mreader:browse:'));while(keys.length>=12)localStorage.removeItem(keys.shift());localStorage.setItem('mreader:browse:'+key,value);}}catch{}
  return result;
  })();browseRequests.set(key,pending);try{return await pending;}finally{browseRequests.delete(key);}
}
function browseProblemMessage(error){
 const message=String(error);
 if(/not available in (?:your|this) (?:country|region)|geo.?restrict/i.test(message))return 'Not available in your country.';
 if(/browser verification|cloudflare|captcha|browser challenge/i.test(message))return 'This source requires browser verification before it can load.';
 if(/UnknownHost|EAI_NODATA|network|failed to fetch|connection|offline|DNS/i.test(message))return 'Could not reach this source. Check your connection and retry.';
 if(/timeout|timed out/i.test(message))return 'This source took too long to respond. Try again later.';
 if(/401|403|unauthorized|forbidden/i.test(message))return 'This source denied access. It may require sign-in or an updated extension.';
 return 'Could not load this source. Try again or check its extension.';
}
function recordBrowseFailure(source,error){
 skipFailedSource(source,error);browseFailures.set(source.id,{id:source.id,name:source.name,message:browseProblemMessage(error)});
}
function browseIssueView(){
 if(state.page!=='Browse')return '';
 const skipped=state.source==='all'?skippedSources():[],issues=new Map([...browseFailures]);
 for(const source of skipped)issues.set(source.id,{id:source.id,name:source.name,message:sourceSkipStatus(source.id).reason});
 if(!issues.size)return '';
 const summary=skipped.length===issues.size?`${skipped.length} ${skipped.length===1?'source':'sources'} skipped in All`:`${issues.size} ${issues.size===1?'source needs':'sources need'} attention`;
 return `<details class="browse-source-notice" ${state.catalog.length?'':'open'}><summary>${esc(summary)}</summary><p>${allSourcesSkipped()?'All sources are currently skipped. Retry or re-enable them, or select a single source to check it.':state.catalog.length?'Working results remain available below. Skipped sources stay installed.':'These sources could not load results.'}</p><div class="browse-source-issues">${[...issues.values()].map(issue=>sourceIsSkipped(issue.id)?sourceSkipRow({id:issue.id,name:issue.name}):`<div class="browse-source-issue"><b>${esc(issue.name)}</b><small>${esc(issue.message)}</small><div class="button-row">${sourceSkipActions(issue.id)}</div></div>`).join('')}</div>${button('browse-retry-failed',state.loading?'Loading…':skipped.length?'Retry skipped sources':'Retry failed sources','secondary',state.loading?'disabled':'')}</details>`;
}
async function searchAllSources(more,version,force=false,retrySources=null) {
 const sources=userSources(),retry=Array.isArray(retrySources);
 if(!more&&!retry){browseOffsets=new Map();browseMore=new Set(sources.filter(s=>!sourceIsSkipped(s.id)).map(s=>s.id));}
 const pending=sources.filter(s=>retry?retrySources.includes(s.id):browseMore.has(s.id)&&!sourceIsSkipped(s.id));
 let cursor=0,books=more||retry?state.catalog.flatMap(b=>browseVariants.get(b.id)||[b]):[];
 const current=()=>version===searchVersion&&state.page==='Browse';
 await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
  while(cursor<pending.length){const source=pending[cursor++];
   try{
    const offset=browseOffsets.get(source.id)??(source.id.startsWith('apk:')?1:0);
    const r=await cachedSourceSearch(source.id,state.query,offset,force);if(!current())return;
    clearSourceSkip(source.id);browseFailures.delete(source.id);
    books.push(...r.books);browseOffsets.set(source.id,offset+(source.id.startsWith('apk:')?1:r.books.length));
    if(!r.books.length||r.total<=(source.id.startsWith('apk:')?r.books.length:offset+r.books.length))browseMore.delete(source.id);else browseMore.add(source.id);
    books=books.filter(b=>!sourceIsSkipped(b.source));state.catalog=mergeBrowseBooks(books);state.total=state.catalog.length+(browseMore.size?1:0);render();
   }catch(e){if(!current())return;recordBrowseFailure(source,e);browseMore.delete(source.id);books=books.filter(b=>!sourceIsSkipped(b.source));state.catalog=mergeBrowseBooks(books);state.total=state.catalog.length+(browseMore.size?1:0);render();}
  }
 }));
 if(current()){state.total=state.catalog.length+(browseMore.size?1:0);}
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
function restoredRefreshView(){
 const r=featureState.restoreRefresh;if(!r)return '';
 return `<div class="feature-note" role="status"><b>${r.active?(r.phase==='extensions'?'Preparing associated extensions…':'Checking restored titles against their sources…'):'Source refresh finished'}</b><p>${r.done}/${r.ids.length} titles checked · Chapters and cover art</p><progress max="${r.ids.length||1}" value="${r.done}" aria-label="Restored title refresh progress"></progress></div>${r.errors.length?`<div class="migration-attention"><h3>Source refresh needs attention</h3><ul>${r.errors.map(e=>`<li>${esc(e.title)}: ${esc(e.error)}</li>`).join('')}</ul>${!r.active?button('restore-refresh-retry','Retry source refresh','secondary'):''}</div>`:''}`;
}
const extensionInstallJobs=new Map();
async function installAssociatedExtension(match){
 const key=match.repository+'|'+match.package;
 if(extensionInstallJobs.has(key))return extensionInstallJobs.get(key);
 const job=api('apk_install',match);extensionInstallJobs.set(key,job);
 try{return await job;}finally{extensionInstallJobs.delete(key);}
}
async function prepareMigratedExtensions(ids){
 let apk=await api('apk_state');const failures=new Map(),attempted=new Map();
 const sources=[...new Set(ids.map(id=>bookById(id)?.source).filter(s=>s?.startsWith('apk:')))];
 for(const source of sources){const id=source.slice(4);
  if(apk.installed.some(e=>e.extension.sources.some(s=>String(s.id)===id)))continue;
  const matches=apk.repositories.flatMap(r=>r.catalog.extensions.filter(e=>e.sources.some(s=>String(s.id)===id)).map(e=>({repository:r.url,package:e.package})));
  const unique=[...new Map(matches.map(e=>[e.repository+'|'+e.package,e])).values()];
  if(unique.length!==1){failures.set(source,unique.length?'Multiple matching extensions found. Choose one in Settings → Sources, then retry.':'Add a repository containing this source in Settings → Sources, then retry.');continue;}
  const key=unique[0].repository+'|'+unique[0].package;
  if(attempted.has(key)){failures.set(source,attempted.get(key));continue;}
  try{apk=await installAssociatedExtension(unique[0]);if(!apk.installed.some(e=>e.extension.sources.some(s=>String(s.id)===id)))throw Error('Installed extension does not provide the required source');}
  catch(error){const message='Extension preparation failed: '+String(error);attempted.set(key,message);failures.set(source,message);}
 }
 for(const source of failures.keys()){if(apk.installed.some(e=>e.extension.sources.some(s=>'apk:'+s.id===source)))failures.delete(source);}
 featureState.apk=apk;
 if(featureState.migrationResult?.sources)featureState.migrationResult.missing=[...new Set(featureState.migrationResult.sources.filter(s=>!apk.installed.some(e=>e.extension.sources.some(v=>String(v.id)===String(s.id)))).map(s=>s.name))];
 return failures;
}
async function refreshRestoredBooks(ids){
 if(featureState.restoreRefresh?.active)return;
 ids=[...new Set(ids)].filter(id=>state.books.some(b=>b.id===id&&b.source!=='local'));
 const r=featureState.restoreRefresh={ids,done:0,errors:[],active:true,phase:'extensions'};let next=0;
 const redraw=()=>{if(['Settings','More'].includes(state.page)&&!state.reader)render();};redraw();
 let preparation;try{preparation=await prepareMigratedExtensions(ids);}catch(error){r.active=false;r.errors=ids.map(id=>({id,title:bookById(id)?.title||id,error:'Could not check extensions: '+String(error)}));redraw();return;}
 r.phase='refresh';redraw();
 async function worker(){while(next<ids.length){const id=ids[next++],title=bookById(id)?.title||id;
  try{const problem=preparation.get(bookById(id)?.source);if(problem)throw Error(problem);const result=await api('refresh_restored_book',{bookId:id});const index=state.books.findIndex(b=>b.id===id);if(index>=0)state.books[index]=result.book;
   const old=coverCache.get(id);if(old)URL.revokeObjectURL(old);coverCache.delete(id);
   if(result.warnings?.length)r.errors.push({id,title,error:result.warnings.join(' ')});
  }catch(e){r.errors.push({id,title,error:String(e)});}finally{r.done++;redraw();}
 }}
 try{await Promise.all([worker(),worker()]);}finally{r.active=false;redraw();queueAccountSync();}
}
document.addEventListener('click',event=>{if(event.target.closest('[data-action="restore-refresh-retry"]'))refreshRestoredBooks(featureState.restoreRefresh.errors.map(e=>e.id));});
function migrationView(embedded=false){
 const p=featureState.migration;const importCount=p?(featureState.migrationHistory?p.manga.length:(p.libraryCount??p.manga.length)):0;
 return `<section class="${embedded?'settings-subsection':'feature-panel'} migration-panel"><div class="feature-heading"><div><h${embedded?3:2}>Migration</h${embedded?3:2}><p>Import manga, categories and reading progress from a Mihon / Tachiyomi backup. Preview it locally first.</p></div><label class="secondary">Choose backup<input id="migration-file" type="file" accept=".tachibk,.gz" hidden></label></div>${featureState.migrationBusy?'<p role="status">Reading backup…</p>':''}${restoredRefreshView()}${featureState.migrationResult?`<div class="migration-success" role="status"><h3>Migration successful</h3><p>${featureState.migrationResult.imported} manga imported. Library and reading progress have been saved on this device.</p></div>${featureState.migrationResult.missing.length?`<div class="migration-attention" role="note"><h3>Action needed: install missing sources</h3><p>Install these sources in Settings → Sources to read their chapters:</p><ul>${featureState.migrationResult.missing.map(name=>`<li>${esc(name)}</li>`).join('')}</ul></div>`:''}${featureState.migrationResult.warnings.map(w=>`<p class="migration-attention">${esc(w)}</p>`).join('')}`:''}${featureState.migrationError?`<p class="notice" role="alert">${esc(featureState.migrationError)}</p>`:''}${p?`<div class="migration-summary"><b>${p.manga.length} manga</b><span>${p.libraryCount??p.manga.length} in library</span><span>${p.chapters} chapters</span><span>${p.read} read</span><span>${p.manga.reduce((n,m)=>n+m.inProgress,0)} in progress</span><span>${p.sources.length} source references</span></div>${p.warnings.map(w=>`<p class="migration-attention">${esc(w)}</p>`).join('')}<details open><summary>Manga and reading status</summary><div class="migration-titles">${p.manga.map(m=>`<div><b>${esc(m.title)}</b><small>${m.inLibrary===false?"History only":"In Mihon library"}</small><small>${m.read} read · ${m.inProgress} in progress · ${m.unread} unread · ${esc(m.category)}</small><small>${esc(m.source)} · ${m.installed?'Source installed':'Extension checked automatically on import'}${m.existing?' · Merge with existing title':''}</small></div>`).join('')}</div></details><details><summary>Sources and extensions</summary>${p.sources.map(s=>`<p><b>${esc(s.name)}</b> · ${s.installed?'Installed':'Missing'}<small class="sub">${s.packages.length?' · Matching extension: '+s.packages.map(esc).join(', '):' · Install the matching extension in Sources'}</small></p>`).join('')}</details><details><summary>Repository references (${p.repositories.length})</summary>${p.repositories.map(r=>`<p><b>${esc(r.name)}</b><small class="data-path">${esc(r.url)}</small><small class="data-path">${esc(r.fingerprint)}</small></p>`).join('')}<p class="feature-note">Matching extensions are installed automatically from repositories you already added. Backup repository references are not automatically added or trusted.</p></details>${p.libraryCount<p.manga.length?`<label class="fingerprint-toggle"><input id="migration-history" type="checkbox" ${featureState.migrationHistory?"checked":""}> Also import ${p.manga.length-p.libraryCount} history-only titles</label>`:""}<div class="button-row">${button('migration-import',`Import ${importCount} manga and progress`,'primary',featureState.migrationBusy||featureState.restoreRefresh?.active?'disabled':'')}${button('migration-cancel','Cancel','secondary')}</div><p class="sub">Import prepares matching extensions, merges exact source/title identities and preserves existing downloads and completed chapters. It does not replace the whole library.</p>`:'<p class="feature-note">Supports .tachibk and .proto.gz backups. The file stays on this device. Review and confirm the preview to import; downloaded manga pages must be downloaded separately.</p>'}</section>`;
}
document.addEventListener('change',async event=>{
 if(event.target.id!=='migration-file'||!event.target.files?.[0])return;
 const file=event.target.files[0];featureState.migrationBusy=true;featureState.migrationError='';featureState.migrationResult=null;featureState.migration=null;featureState.migrationHistory=false;render();
 try{if(file.size>32*1024*1024)throw Error('Backup exceeds 32 MiB');featureState.migration=await window.__TAURI__.core.invoke('migration_preview',await file.arrayBuffer());}
 catch(e){featureState.migrationError=String(e);}finally{featureState.migrationBusy=false;render();}
});
document.addEventListener('click',async event=>{
 const t=event.target.closest('[data-action]');if(!t)return;
 if(t.dataset.action==='migration-cancel'){featureState.migration=null;featureState.migrationError='';render();}
 if(t.dataset.action==='migration-import'&&!featureState.migrationBusy&&!featureState.restoreRefresh?.active){
   featureState.migrationBusy=true;render();
   try{const result=await api('migration_import',{confirmed:true,includeHistory:!!featureState.migrationHistory});applySnapshot(result.snapshot);const preview=featureState.migration;const entries=preview.manga.filter(m=>featureState.migrationHistory||m.inLibrary!==false);featureState.migrationResult={imported:result.imported,sources:entries.map(m=>({id:m.sourceId,name:m.source})),missing:[...new Set(entries.filter(m=>!m.installed).map(m=>m.source))],warnings:preview.warnings||[]};featureState.migration=null;queueAccountSync();void refreshRestoredBooks(result.bookIds||[]);toast(`${result.imported} manga imported successfully.`);}
   catch(e){featureState.migrationError=String(e);}finally{featureState.migrationBusy=false;render();}
 }
});
document.addEventListener('error',event=>{if(event.target.matches?.('.extension-icon img'))event.target.remove();},true);
function userSources() {
  return [...(state.settings.komgaUrl ? [{id:'komga',name:'Komga · personal server'}] : []),
    ...featureState.apk.installed.flatMap(e=>e.extension.sources.filter(s=>s.language==='en').map(s=>({id:'apk:'+s.id,language:s.language,name:s.name+' · '+s.language+' (APK)'}))),
    ...featureState.extensions.filter(e=>e.language==='en').map(e=>({id:'ext:'+e.id,language:e.language,name:e.name+' · '+e.language}))];
}
function ensureUserSource() {
  const sources=userSources();
  if(!featureState.browseSourceChosen && sources.length){state.source="all";return;}
  if(state.source==='all' && sources.length)return;
  if(!sources.some(s=>s.id===state.source)) {
    const known=featureState.apk.installed.some(e=>e.extension.sources.some(s=>'apk:'+s.id===state.source));const pending=!known&&featureState.syncedSources.some(e=>e.kind==='apk' && state.source.startsWith('apk:'));
    if(!pending)state.source=sources.length?'all':'';
  }
}
function sourceOptions() {
  ensureUserSource();
  const sources=userSources();
  if(sources.length)sources.unshift({id:'all',name:'All installed sources'});
  const pending=state.source && !sources.some(s=>s.id===state.source);
  return (pending?`<option value="${esc(state.source)}" selected disabled>Synced source · waiting to prepare</option>`:sources.length?'':'<option value="" selected>Add sources in Settings</option>') + sources.map(s=>`<option value="${esc(s.id)}" ${s.id===state.source?'selected':''}>${esc(s.name)}${sourceIsSkipped(s.id)?' · Skipped in All':''}</option>`).join('');
}
function extensionView() {
  return sourceAvailabilityView() + apkView() + `<section class="feature-panel custom-source-panel"><div class="feature-heading"><div><h2>Custom source extensions</h2><p>Import your own source extension to use on your devices.</p></div><div class="button-row">${typeof useMobileLayout==='function'&&useMobileLayout()?button('import','Import manga files','secondary'):''}<label class="secondary">Import manifest<input type="file" id="extension-file" accept=".json" hidden></label></div></div>${featureState.extensions.length ? featureState.extensions.map((e) => `<div class="extension-row"><div><b>${esc(e.name)}</b><small>Version ${esc(e.version)}</small></div><div class="button-row">${extensionFlagButton("native:"+e.id)}${button("extension-export", "Export", "secondary", `data-extension="${esc(e.id)}"`)}${button("extension-remove", "Uninstall", "secondary", `data-extension="${esc(e.id)}"`)}</div></div>`).join("") : '<p class="sub">No native extensions installed. Import your own manifest to add a source.</p>'}<p class="feature-note">Add an extension list above to find more sources. Updating an extension keeps your library and reading progress.</p></section>`;
}
function accountView() {
  const c = featureState.cloud;
  return `<section class="feature-panel"><div class="feature-heading"><div><h2>Account & device sync</h2><p>${c.profile === "account" ? "Your account library is stored separately from this device’s guest library." : "Sign in to the same account on supported builds to share your library and reading progress."}</p></div><span class="connection-pill">${!c.configured ? "Not configured" : c.signedIn ? "Signed in" : "Ready to sign in"}</span></div>${c.signedIn ? `<p>${esc(c.email || "Your account")}</p><p class="sub">${featureState.syncing ? "Syncing…" : c.lastSync ? "Last synced " + new Date(c.lastSync).toLocaleString() : "Not synced yet"}${featureState.syncError ? " · " + esc(featureState.syncError) : ""}</p><div class="button-row">${button("cloud-sync", "Sync now", "primary")}${button("cloud-logout", "Sign out")}</div>` : !c.configured ? '<p class="notice">Account sync is currently unavailable. You can still read and manage your library on this device.</p>' : `<form id="account-form" class="account-form"><input name="email" type="email" required autocomplete="username" placeholder="Email" aria-label="Account email"><input name="password" type="password" minlength="8" required autocomplete="current-password" placeholder="Password" aria-label="Account password"><div class="button-row"><button type="submit" class="primary">Sign in</button><button type="submit" class="secondary" name="register" value="yes">Create account</button></div></form>`}${c.configured?button("cloud-password-open","Forgot password?","secondary account-recovery-button"):""}<p class="feature-note">Sync shares metadata, extension definitions, favorites, and reading progress. It excludes passwords, local file paths, and manga bytes. Local files must be imported on each device. Use the same account on each device to share progress.</p>${sourceSyncView()}</section>`;
}
function openPasswordRecovery(){
 document.querySelector('#password-recovery')?.remove();
 const email=document.querySelector('#account-form [name=email]')?.value||featureState.cloud.email||'';
 const layer=document.createElement('div');layer.id='password-recovery';layer.className='modal-backdrop';
 layer.innerHTML=`<section class="modal password-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="password-recovery-heading"><h2 id="password-recovery-heading">Reset password</h2><p>Request an email, then copy its password reset link and paste it here. You do not need to open the link in a browser.</p><form id="password-recovery-email"><label>Account email<input name="email" type="email" required maxlength="320" autocomplete="username" aria-label="Recovery email" value="${esc(email)}"></label><button class="primary" type="submit">Send reset email</button></form><p class="recovery-status" role="status" aria-live="polite"></p><form id="password-recovery-complete"><label>Reset link from your email<input name="resetLink" type="password" autocomplete="off" required maxlength="16384" aria-label="Password reset link"></label><label>New password<input name="newPassword" type="password" required minlength="8" maxlength="1024" autocomplete="new-password" aria-label="New password"></label><label>Confirm new password<input name="confirmPassword" type="password" required minlength="8" maxlength="1024" autocomplete="new-password" aria-label="Confirm new password"></label><button class="primary" type="submit">Update password</button></form>${button('password-recovery-close','Close','secondary')}</section>`;
 const status=layer.querySelector('.recovery-status');let busy=false;
 layer.closeRecovery=()=>{if(!busy)layer.remove();};
 function setBusy(value){busy=value;layer.querySelectorAll('button').forEach(button=>button.disabled=value);}
 layer.addEventListener('click',event=>{if(event.target.closest('[data-action=password-recovery-close]')&&!busy)layer.remove();});
 layer.addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy)layer.remove();});
 layer.addEventListener('submit',async event=>{
  if(!['password-recovery-email','password-recovery-complete'].includes(event.target.id))return;
  event.preventDefault();if(busy)return;
  const form=event.target,values=new FormData(form),send=form.id==='password-recovery-email';
  if(!send&&values.get('newPassword')!==values.get('confirmPassword')){status.textContent='The passwords do not match.';return;}
  setBusy(true);status.textContent=send?'Sending recovery email…':'Updating password…';
  try{
   if(send){await api('cloud_password_recovery',{email:String(values.get('email')).trim()});status.textContent='If an account exists for that email, a reset email has been requested. Check your inbox and spam folder.';}
   else{await api('cloud_password_reset',{resetLink:String(values.get('resetLink')).trim(),password:String(values.get('newPassword'))});form.reset();status.textContent='Password updated. Use your new password the next time you sign in.';form.hidden=true;}
  }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
  finally{setBusy(false);}
 });
 document.body.append(layer);layer.querySelector('[name=email]').focus();
}
function extensionFlagButton(id){
 const flagged=(state.settings.flaggedExtensions||[]).includes(id);
 return `${flagged?'<span class="connection-pill source-issue-tag">Flagged as not working</span>':''}${button('extension-flag',flagged?'Clear flag':'Flag as not working','secondary',`data-extension-flag="${esc(id)}" aria-pressed="${flagged}"`)}`;
}
function apkView() {
  const a=featureState.apk, q=featureState.apkQuery.trim().toLowerCase();
  const entries=a.repositories.flatMap(r => r.catalog.extensions.map(extension => ({repository:r.url,extension})));
  const filtered=entries.filter(({extension:e}) => q ? `${e.name} ${e.package} ${e.sources.map(s=>s.name+" "+s.language).join(" ")}`.toLowerCase().includes(q) : e.sources.some(s=>s.language==="en"));
  const installed=p=>a.installed.find(e=>e.extension.package===p);
  const layout=state.settings.apkLayout === "stacked" ? "stacked" : "list";
  filtered.sort((a,b)=>Number(!!installed(b.extension.package))-Number(!!installed(a.extension.package)) || a.extension.name.localeCompare(b.extension.name));
  return `<section class="feature-panel apk-panel"><div class="feature-heading"><div><h2>APK source extensions</h2><p>Mreader does not provide extension lists. Add a repository you obtained independently, then install its extensions on this device. Your sources and reading progress are shared across your signed-in devices.</p></div></div><p class="feature-note">Install extensions only from repositories you trust. They let Mreader connect to the manga sources you choose.</p>${installedRepositoryView()}<details><summary>Add extension repository</summary><form id="apk-repository-form" class="account-form"><input name="url" type="url" required placeholder="HTTPS repository or index.pb URL" aria-label="Extension repository URL"><label class="fingerprint-toggle"><input id="manual-fingerprint" type="checkbox"> Enter a signing fingerprint manually</label><label id="fingerprint-field" hidden>Repository signing fingerprint<input name="fingerprint" disabled pattern="[a-fA-F0-9]{64}" placeholder="Trusted signing fingerprint (64 hex characters)" aria-label="Repository signing fingerprint"></label><p class="feature-note">Previously added repositories use their saved fingerprint. For a new repository, enter the signing fingerprint you obtained and verified independently.</p><button class="secondary" ${featureState.apkBusy?"disabled":""}>Add repository</button></form></details>${featureState.apkBusy?'<p role="status"><span class="spinner"></span> Preparing extension…</p>':""}${featureState.apkError?`<p class="notice" role="alert">${esc(featureState.apkError)}</p>`:""}${entries.length?`<label class="apk-search-label">Find an extension<input id="apk-search" type="search" value="${esc(featureState.apkQuery)}" placeholder="Source name or language (default: English)"></label><div class="apk-display-controls" role="group" aria-label="Extension layout">${button("apk-layout","List",layout==="list"?"primary":"secondary",'data-layout="list" aria-pressed="'+(layout==="list")+'"')}${button("apk-layout","Stacked",layout==="stacked"?"primary":"secondary",'data-layout="stacked" aria-pressed="'+(layout==="stacked")+'"')}</div><p class="sub">${filtered.length} matching packages · ${a.installed.length} installed on this device</p><div class="apk-extension-results apk-layout-${layout}">${filtered.slice(0,60).map(({extension:e,repository})=>{const old=installed(e.package),up=old&&old.extension.versionCode<e.versionCode,issue=e.sources.some(source=>sourceIsSkipped("apk:"+source.id))||(state.settings.flaggedExtensions||[]).includes("apk:"+e.package);return `<div class="extension-row${issue?' extension-has-issue':''}"><div class="extension-identity">${extensionIcon(e)}<div><b>${esc(e.name)}</b>${issue?'<span class="source-issue-tag">Needs attention</span>':''}<small>${esc(e.version)} · ${[...new Set(e.sources.map(s=>s.language))].map(esc).join(", ")}${e.contentWarning>=2?" · Mature content":""}</small></div></div><div class="button-row">${!old||up?button("apk-install",up?"Update":"Install","secondary",`data-package="${esc(e.package)}" data-repository="${esc(repository)}" ${featureState.apkBusy?"disabled":""}`):'<span class="connection-pill">Installed</span>'}${old?extensionFlagButton("apk:"+e.package):""}${old?button("apk-remove",featureState.cloud.signedIn?"Remove everywhere":"Uninstall","secondary",`data-package="${esc(e.package)}" ${featureState.apkBusy?"disabled":""}`):""}</div></div>`}).join("")}</div>${filtered.length>60?'<p class="sub">Showing 60 results. Search to narrow the list.</p>':""}`:'<p class="sub">Add a repository to browse installable sources.</p>'}<p class="feature-note">Flags are your manual notes on this device. They do not uninstall or disable an extension. A working website may still have an outdated or incompatible extension. Installed source choices sync with your account; each device prepares its own copy. Uninstalling preserves your library and progress. A source may require its own website account or verification; installing an extension does not grant access.</p></section>`;
}
async function apkAction(command,args) {
  if(featureState.apkBusy)return;
  const removedSources=command==='apk_remove'?(featureState.apk.installed.find(e=>e.extension.package===args.package)?.extension.sources||[]).map(s=>'apk:'+s.id):[];
  featureState.apkBusy=true;featureState.apkError="";render();
  try {
    featureState.apk=await api(command,args);
    const local=await api('cloud_status');
    if(Array.isArray(local.sourceChoices))featureState.syncedSources=local.sourceChoices;
    if(featureState.browseSourceChosen&&state.source!=="all"&&local.preferredSource)state.source=local.preferredSource;
    featureState.sourceSyncErrors=[];
    ensureUserSource();
    releaseCoverCache();if(removedSources.length){for(const source of removedSources){sourceRepair.attempted.add(source);sourceRepair.errors.set(source,'Extension was removed. Use Check / install extension to restore it.');}}else sourceRepair.attempted.clear();void repairMissingBookExtensions();toast("Extension list updated");
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
document.addEventListener('click',async event=>{
 const t=event.target.closest('[data-action]');if(!t)return;
 if(t.dataset.action==='browse-retry-failed'&&!state.loading){const ids=[...new Set([...browseFailures.keys(),...(state.source==='all'?skippedSources().map(s=>s.id):[])])];if(ids.length)await searchSource(false,true,ids);}
 if(t.dataset.action==='source-verify'&&!sourceChecks.has(t.dataset.sourceId)){
  const id=t.dataset.sourceId;sourceChecks.add(id);render();
  try{if(featureState.sourceVerification)await api('source_verification_finish',{id:featureState.sourceVerification.id,cancel:true});featureState.sourceVerification=await api('source_verification_open',{source:id});}
  catch(error){toast(error);}finally{sourceChecks.delete(id);render();if(state.detail)renderDetails();}
 }
 if(['source-verify-finish','source-verify-cancel'].includes(t.dataset.action)&&featureState.sourceVerification){const session=featureState.sourceVerification;featureState.sourceVerification=null;try{await api('source_verification_finish',{id:session.id,cancel:t.dataset.action==='source-verify-cancel'});if(t.dataset.action==='source-verify-finish')await checkSourceAvailability(session.source);}catch(error){toast(error);}render();if(state.detail)renderDetails();}
 if(t.dataset.action==='source-enable'&&!state.loading&&!sourceChecks.has(t.dataset.sourceId)){clearSourceSkip(t.dataset.sourceId);browseFailures.delete(t.dataset.sourceId);render();toast('Source enabled for the next All sources refresh.');}
 if(t.dataset.action==='source-check'&&!state.loading){const id=t.dataset.sourceId;if(state.page==='Browse'&&(state.source==='all'||state.source===id))await searchSource(false,true,state.source==='all'?[id]:null);else await checkSourceAvailability(id);}
 if(t.dataset.action==='repository-refresh')await apkAction('apk_repository',{url:t.dataset.repository,trustKey:null});
 if(t.dataset.action==='files-layout'){try{applySnapshot(await api('save_settings',{settings:{...state.settings,filesLayout:t.dataset.layout,komgaPassword:''}}));render();}catch(error){toast(error);}}
 if(['cover-warning-hide','cover-warning-show'].includes(t.dataset.action)){const ids=new Set(state.settings.dismissedCoverWarnings||[]);if(t.dataset.action==='cover-warning-hide')ids.add(t.dataset.id);else ids.delete(t.dataset.id);try{applySnapshot(await api('save_settings',{settings:{...state.settings,dismissedCoverWarnings:[...ids],komgaPassword:''}}));if(state.detail)renderDetails();}catch(error){toast(error);}}
 if(t.dataset.action==='enlarge-cover'&&t.closest('#detail .detail-cover'))enlargeCover(t.dataset.id);
 if(t.dataset.action==='search-cover-images')showCoverImageSearch(t.dataset.id);
 if(t.dataset.action==='retry-source-cover'){
  const id=t.dataset.id;coverGeneration.set(id,(coverGeneration.get(id)||0)+1);const old=coverCache.get(id);if(old)URL.revokeObjectURL(old);coverCache.delete(id);coverFailed.delete(id);loadCovers();toast('Retrying cover from its installed source…');
 }
});
async function applyCustomCover(id,file){
 if(file.size>10*1024*1024)throw Error('Choose an image smaller than 10 MiB');
 const bytes=await window.__TAURI__.core.invoke('set_custom_cover',await file.arrayBuffer(),{headers:{'x-mreader-book':encodeURIComponent(id)}});
 coverGeneration.set(id,(coverGeneration.get(id)||0)+1);const old=coverCache.get(id);if(old)URL.revokeObjectURL(old);coverCache.set(id,URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})));coverFailed.delete(id);
 applySnapshot(await api('snapshot'));queueAccountSync();
 if(!state.reader){render();if(state.detail)renderDetails();}toast('Custom cover saved. Included in backups and account sync.');
}
function chooseCustomCover(id){
 if(!state.books.some(b=>b.id===id)){toast('Add this manga to your library before choosing its cover.');return;}
 const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,image/gif,image/bmp';input.id='custom-cover-file';input.hidden=true;document.body.append(input);
 input.addEventListener('cancel',()=>input.remove());input.onchange=async()=>{try{if(input.files?.[0])await applyCustomCover(id,input.files[0]);}catch(error){toast(error);}finally{input.remove();}};input.click();
}
document.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('[data-action="enlarge-cover"]')){event.preventDefault();event.target.click();}});
document.addEventListener("click",async e=>{
  const t=e.target.closest("[data-action]");if(!t)return;
  if(t.dataset.action==="extension-flag"){
    const id=t.dataset.extensionFlag;const flags=new Set(state.settings.flaggedExtensions||[]);
    if(flags.has(id))flags.delete(id);else flags.add(id);
    try{applySnapshot(await api('save_settings',{settings:{...state.settings,flaggedExtensions:[...flags],komgaPassword:''}}));render();}catch(error){toast(error);}
  }
  if(t.dataset.action==="settings-section"){featureState.settingsTab=t.dataset.section;render();window.scrollTo?.(0,0);}
  if(t.dataset.action==="apk-layout"){try{applySnapshot(await api('save_settings',{settings:{...state.settings,apkLayout:t.dataset.layout,komgaPassword:''}}));render();}catch(error){toast(error);}}
  if(t.dataset.action==="android-download-start")await startMobileDownload();
  if(t.dataset.action==="android-download-stop"){try{await api('mobile_download_stop');clearTimeout(featureState.mobileDownloadTimer);featureState.mobileDownload=null;render();}catch(error){toast(error);}}
  if(t.dataset.action==="apk-install")await apkAction("apk_install",{repository:t.dataset.repository,package:t.dataset.package});
  if(t.dataset.action==="apk-remove")await apkAction("apk_remove",{package:t.dataset.package});
});
document.addEventListener("submit",async e=>{
  if(e.target.id!=="apk-repository-form")return;e.preventDefault();
  const form=new FormData(e.target);
  const url=canonicalRepositoryUrl(form.get('url'));if(featureState.apk.repositories.some(r=>canonicalRepositoryUrl(r.url)===url)){toast('This extension list is already added. Use Refresh list to update it.');return;}await apkAction('apk_repository',{url,trustKey:(form.get('fingerprint')||'').trim().toLowerCase()||null});
});
function releaseCoverCache() {
  browseCache.clear();browseViews.clear();sourcePreviews.clear();browseFailures.clear();
  try{for(const key of Object.keys(localStorage))if(key.startsWith('mreader:browse:'))localStorage.removeItem(key);}catch{}
  for(const id of new Set([...coverPending,...coverCache.keys()]))coverGeneration.set(id,(coverGeneration.get(id)||0)+1);
  for (const url of coverCache.values()) URL.revokeObjectURL(url);
  coverCache.clear();
  coverFailed.clear();
}
async function loadFeatures() {
  const [extensions, cloud, plan, apk, appVersion] = await Promise.all([
    api("extension_list"),
    api("cloud_status"),
    api("verification_plan"),
    api("apk_state"),
    window.__TAURI__?.app?.getVersion ? window.__TAURI__.app.getVersion().catch(()=>null) : Promise.resolve(null),
  ]);
  featureState.appVersion = appVersion;
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
    const changed=featureState.browseSourceChosen && state.source!=="all" && result.preferredSource && result.preferredSource!==state.source;
    if(changed){state.source=result.preferredSource;state.catalog=[];state.total=0;searchVersion++;}
    ensureUserSource();
    void repairMissingBookExtensions();
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
  if(!featureState.cloud.signedIn)return '<div class="settings-subsection account-sources-sync"><h3>Sources across devices</h3><p>Sign in to share installed source choices between your devices. Website logins stay on each device.</p></div>';
  const pending=featureState.syncedSources.filter(e=>e.kind==='apk').map(e=>e.value).filter(e=>!featureState.apk.installed.some(old=>old.extension.package===e.package));
  return `<div class="settings-subsection account-sources-sync"><h3>Sources across devices</h3><p>Your installed source choices and active Browse source sync using Sync now above. Website logins stay on each device.</p>${pending.map(e=>`<div class="extension-row"><div><b>${esc(e.name)}</b><small>Waiting to prepare on this device</small></div>${button('apk-remove','Remove from synced sources','secondary',`data-package="${esc(e.package)}"`)}</div>`).join('')}${featureState.sourceSyncErrors.map(error=>`<p class="notice" role="alert">${esc(error)}</p>`).join('')}</div>`;
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
      case "cloud-password-open":
        openPasswordRecovery();
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

function showCoverImageSearch(id){
 const book=state.books.find(b=>b.id===id);if(!book){toast('Add this manga to your library before choosing its cover.');return;}
 document.querySelector('#cover-image-search')?.remove();
 const layer=document.createElement('div');layer.id='cover-image-search';layer.className='modal-backdrop';layer.style.zIndex='60';
 layer.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-label="Find cover art"><h2>Find cover art</h2><p>Search Google Images for ${esc(book.title)}, save your chosen image, then return here and choose the saved image.</p><p>Your cover stays saved, is included in backups, and syncs with your signed-in account.</p><div class="button-row">${button('retry-source-cover','Retry source cover','secondary',`data-id="${esc(id)}"`)}${button('cover-google-open','Open Google Images','primary')}${button('cover-image-select','Choose saved image','secondary')}${button('cover-search-close','Cancel','secondary')}</div></section>`;
 layer.addEventListener('click',async event=>{const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='cover-search-close'||action==='retry-source-cover')layer.remove();
  if(action==='cover-image-select'){layer.remove();chooseCustomCover(id);}
  if(action==='cover-google-open'){try{if(window.MreaderChrome?.searchCoverImages)window.MreaderChrome.searchCoverImages(book.title);else await api('cover_image_search',{bookId:id});}catch(error){toast(error);}}
 });document.body.append(layer);
}

function sourceVerificationPreview(source){
 return featureState.sourceVerification?.source===source?`<div class="preview-verification" role="status"><p>Complete the human verification in the source browser, then return here.</p>${button('source-verify-finish','Finish verification','secondary')}${button('source-verify-cancel','Cancel verification','secondary')}</div>`:'';
}
function enlargeCover(id){
 const book=state.books.find(b=>b.id===id)||(state.detail?.id===id?state.detail:null),url=coverCache.get(id);
 if(!book||!url){toast('No cover art is available. Use Search cover images to add one.');return;}
 document.querySelector('#cover-enlargement')?.remove();
 const layer=document.createElement('div');layer.id='cover-enlargement';layer.className='modal-backdrop cover-enlargement';
 layer.innerHTML=`<section role="dialog" aria-modal="true" aria-label="Enlarged cover for ${esc(book.title)}">${button('close-cover-enlargement',icon('close'),'icon-button', 'aria-label="Close enlarged cover"')}<img src="${esc(url)}" alt="${esc(book.title)} cover"></section>`;
 layer.addEventListener('click',e=>{if(!e.target.closest('img')||e.target.closest('[data-action=close-cover-enlargement]')){layer.remove();document.querySelector('#detail [data-action=enlarge-cover]')?.focus();}});document.body.append(layer);layer.querySelector('button').focus();
}
