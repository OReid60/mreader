mod cloud;
mod credentials;
mod extensions;
mod local;
mod model;
mod sources;
mod store;
use futures_util::{stream, StreamExt};
use model::*;
use std::{
    collections::{HashMap, HashSet},
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager, State};
type Result<T> = std::result::Result<T, String>;
struct Core {
    store: store::Store,
    local: local::LocalReader,
    sources: sources::Sources,
    data: PathBuf,
    manifests: Mutex<HashMap<String, sources::Manifest>>,
    downloads: Mutex<HashSet<String>>,
    cloud: cloud::Cloud,
    verification: Option<PathBuf>,
}
impl Core {
    fn new(data: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let cloud = cloud::Cloud::new(&data)?;
        let profile = cloud.profile_dir(&data)?;
        let sources = sources::Sources::new()?;
        sources.extensions.set_dir(&profile.join("extensions"))?;
        Ok(Self {
            store: store::Store::open(&profile.join("library.sqlite"))?,
            local: local::LocalReader::new(),
            sources,
            cloud,
            verification: std::env::var_os("MREADER_VERIFY_REPORT").map(PathBuf::from),
            data,
            manifests: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashSet::new()),
        })
    }
    fn settings(&self) -> Result<Settings> {
        let mut s = self.store.settings()?;
        if !s.komga_url.is_empty() {
            s.komga_password = crate::credentials::Entry::new("Mreader.Komga", &s.komga_url)
                .ok()
                .and_then(|e| e.get_password().ok())
                .unwrap_or_default()
        }
        Ok(s)
    }
    fn snapshot(&self) -> Result<Snapshot> {
        Ok(Snapshot {
            books: self.store.books()?,
            progress: self.store.progress()?,
            settings: self.store.settings()?,
            data_dir: self.data.to_string_lossy().into(),
        })
    }
    async fn manifest(&self, b: &Book, c: &Chapter) -> Result<sources::Manifest> {
        let key = format!("{}:{}", b.id, c.id);
        if let Some(m) = self.manifests.lock().map_err(|e| e.to_string())?.get(&key) {
            if m.created.elapsed() < Duration::from_secs(240) {
                return Ok(m.clone());
            }
        }
        let m = self.sources.manifest(b, c, &self.settings()?).await?;
        let mut cache = self.manifests.lock().map_err(|e| e.to_string())?;
        if cache.len() > 64 {
            cache.clear()
        }
        cache.insert(key, m.clone());
        Ok(m)
    }
}
#[tauri::command]
fn snapshot(core: State<Arc<Core>>) -> Result<Snapshot> {
    core.snapshot()
}
#[tauri::command]
async fn search_source(
    core: State<'_, Arc<Core>>,
    source: String,
    query: String,
    offset: usize,
) -> Result<Catalog> {
    core.sources
        .search(&source, &query, offset, &core.settings()?)
        .await
}
#[tauri::command]
fn add_book(core: State<Arc<Core>>, mut book: Book) -> Result<Snapshot> {
    if let Some(id) = book.source.strip_prefix("ext:") {
        core.sources.extensions.get(id)?;
    } else if !matches!(book.source.as_str(), "mangadex" | "komga") {
        return Err("Local books must be added using Import".into());
    }
    if book.source.starts_with("ext:") {
        if book.remote_id.is_empty()
            || book.remote_id.len() > 512
            || book.remote_id.chars().any(char::is_control)
        {
            return Err("Invalid extension manga identifier".into());
        }
    } else {
        sources::valid_id(&book.remote_id)?;
    }
    book.path.clear();
    book.chapters.clear();
    if let Ok(existing) = core.store.book(&book.id) {
        book = existing
    }
    core.store.put(&book)?;
    core.snapshot()
}
#[tauri::command]
fn remove_book(core: State<Arc<Core>>, book_id: String) -> Result<Snapshot> {
    core.store.remove(&book_id)?;
    core.snapshot()
}
#[tauri::command]
fn favorite(core: State<Arc<Core>>, book_id: String) -> Result<Snapshot> {
    let mut b = core.store.book(&book_id)?;
    b.favorite = !b.favorite;
    core.store.put(&b)?;
    core.snapshot()
}
#[tauri::command]
async fn chapters(core: State<'_, Arc<Core>>, book_id: String, refresh: bool) -> Result<Book> {
    let mut b = core.store.book(&book_id)?;
    if b.source != "local" && (refresh || b.chapters.is_empty()) {
        let mut chapters = core.sources.chapters(&b, &core.settings()?).await?;
        b = core.store.book(&book_id)?;
        for chapter in &mut chapters {
            if let Some(old) = b
                .chapters
                .iter()
                .find(|c| c.id == chapter.id && c.downloaded)
            {
                chapter.path = old.path.clone();
                chapter.downloaded = true;
                chapter.pages = old.pages;
            }
        }
        b.chapters = chapters;
        core.store.put(&b)?
    }
    Ok(b)
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn import_files(core: State<'_, Arc<Core>>, folder: bool) -> Result<serde_json::Value> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let paths = if folder {
            rfd::FileDialog::new()
                .set_title("Import a manga folder")
                .pick_folder()
                .map(|p| vec![p])
        } else {
            rfd::FileDialog::new()
                .set_title("Import manga files")
                .add_filter("Manga", &["cbz", "zip", "cbr", "rar", "pdf"])
                .pick_files()
        };
        import_into(&core, paths.unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn import_paths(core: State<'_, Arc<Core>>, paths: Vec<String>) -> Result<serde_json::Value> {
    if paths.len() > 200 {
        return Err("Import up to 200 paths at a time".into());
    }
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        import_into(&core, paths.into_iter().map(PathBuf::from).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn import_into(core: &Core, paths: Vec<PathBuf>) -> Result<serde_json::Value> {
    core.local.clear_indexes()?;
    let mut errors = Vec::new();
    let mut imported = 0;
    let mut existing = core.store.books()?;
    for p in paths {
        match core.local.import(&p) {
            Ok(mut book) => {
                if let Some(old) = existing
                    .iter()
                    .find(|b| b.id == book.id || b.path == book.path)
                {
                    book.id = old.id.clone();
                    book.favorite = old.favorite;
                    for c in &mut book.chapters {
                        if let Some(prev) = old
                            .chapters
                            .iter()
                            .find(|old| old.id == c.id || old.path == c.path)
                        {
                            c.id = prev.id.clone()
                        }
                    }
                }
                core.store.put(&book)?;
                if let Some(pos) = existing.iter().position(|b| b.id == book.id) {
                    existing[pos] = book;
                } else {
                    existing.push(book);
                }
                imported += 1
            }
            Err(e) => errors.push(format!("{}: {e}", p.display())),
        }
    }
    Ok(serde_json::json!({"snapshot":core.snapshot()?,"imported":imported,"errors":errors}))
}
#[cfg(target_os = "android")]
#[tauri::command]
async fn import_files(_core: State<'_, Arc<Core>>, _folder: bool) -> Result<serde_json::Value> {
    Err("Choose local manga with the Android file picker".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
async fn export_backup(_core: State<'_, Arc<Core>>) -> Result<bool> {
    Err("Backup file export is currently available on desktop".into())
}
#[cfg(target_os = "android")]
#[tauri::command]
async fn restore_backup(_core: State<'_, Arc<Core>>) -> Result<Snapshot> {
    Err("Backup file restore is currently available on desktop".into())
}
#[tauri::command]
async fn import_bytes(
    core: State<'_, Arc<Core>>,
    request: tauri::ipc::Request<'_>,
) -> Result<serde_json::Value> {
    let name = request
        .headers()
        .get("x-mreader-filename")
        .and_then(|h| h.to_str().ok())
        .ok_or("Missing filename")?;
    let name = percent_encoding::percent_decode_str(name)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .to_string();
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(extension.as_str(), "cbz" | "zip" | "pdf") {
        return Err("Mobile import supports CBZ, ZIP, and PDF files".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary file data".into());
    };
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("File exceeds 256 MiB".into());
    }
    let dir = core.data.join("imports");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.{}", uuid::Uuid::new_v4(), extension));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| e.to_string())?;
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut book = match core.local.import(&path) {
            Ok(book) => book,
            Err(error) => {
                core.local.clear_indexes()?;
                let _ = std::fs::remove_file(&path);
                return Err(error);
            }
        };
        book.title = std::path::Path::new(&name)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into();
        for chapter in &mut book.chapters {
            chapter.title = book.title.clone();
        }
        book.description = "Imported into this device's private library. Import the same file on another device to share reading progress.".into();
        if let Ok(old) = core.store.book(&book.id) {
            book.favorite = old.favorite;
        }
        core.store.put(&book)?;
        Ok(serde_json::json!({"snapshot":core.snapshot()?,"imported":1,"errors":[]}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_chapter(
    core: State<'_, Arc<Core>>,
    book_id: String,
    chapter_id: String,
) -> Result<serde_json::Value> {
    let b = core.store.book(&book_id)?;
    if b.source == "local" && b.path.is_empty() {
        return Err("Import the matching local manga file on this device. Its reading progress is already synced.".into());
    }
    let c = b
        .chapters
        .iter()
        .find(|c| c.id == chapter_id)
        .ok_or("Chapter not found")?;
    let pages = if b.source == "local" || c.downloaded {
        c.pages
    } else {
        core.manifests
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&format!("{}:{}", b.id, c.id));
        core.manifest(&b, c).await?.urls.len()
    };
    Ok(serde_json::json!({"pages":pages,"pdf":c.path.to_lowercase().ends_with(".pdf")}))
}
#[tauri::command]
async fn page_data(
    core: State<'_, Arc<Core>>,
    book_id: String,
    chapter_id: String,
    page: usize,
) -> Result<tauri::ipc::Response> {
    let b = core.store.book(&book_id)?;
    let c = b
        .chapters
        .iter()
        .find(|c| c.id == chapter_id)
        .ok_or("Chapter not found")?
        .clone();
    let bytes = if b.source == "local" || c.downloaded {
        let core = core.inner().clone();
        tauri::async_runtime::spawn_blocking(move || core.local.read(&c.path, page))
            .await
            .map_err(|e| e.to_string())??
    } else {
        let manifest = core.manifest(&b, &c).await?;
        let url = manifest
            .urls
            .get(page)
            .ok_or("Page index is outside this chapter")?;
        core.sources.page(url, &b.source, &core.settings()?).await?
    };
    Ok(tauri::ipc::Response::new(bytes))
}
#[tauri::command]
async fn cover_data(core: State<'_, Arc<Core>>, book: Book) -> Result<tauri::ipc::Response> {
    cover_bytes(core.inner().clone(), book)
        .await
        .map(tauri::ipc::Response::new)
}
async fn cover_bytes(core: Arc<Core>, book: Book) -> Result<Vec<u8>> {
    if book.source == "local" {
        let b = core.store.book(&book.id)?;
        if b.path.is_empty() {
            return Err("Import this local title on this device to generate its cover".into());
        }
    }
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    book.id.hash(&mut hash);
    let cache = core
        .data
        .join("covers")
        .join(format!("{:x}.jpg", hash.finish()));
    if let Ok(bytes) = tokio::fs::read(&cache).await {
        return Ok(bytes);
    }
    let bytes = match book.source.as_str() {
        "local" => {
            let stored = core.store.book(&book.id)?;
            let path = stored.chapters.first().ok_or("No cover")?.path.clone();
            if path.to_lowercase().ends_with(".pdf") {
                return Err("PDF cover not available".into());
            }
            let core = core.clone();
            tauri::async_runtime::spawn_blocking(move || core.local.read(&path, 0))
                .await
                .map_err(|e| e.to_string())??
        }
        "komga" => {
            sources::valid_id(&book.remote_id)?;
            let cfg = core.settings()?;
            let url = format!(
                "{}/api/v1/series/{}/thumbnail",
                cfg.komga_url.trim_end_matches('/'),
                book.remote_id
            );
            core.sources.page(&url, "komga", &cfg).await?
        }
        "mangadex" => {
            let url = reqwest::Url::parse(&book.cover).map_err(|_| "No cover is available")?;
            if url.scheme() != "https"
                || url.host_str() != Some("uploads.mangadex.org")
                || !url.path().starts_with("/covers/")
            {
                return Err("Invalid MangaDex cover URL".into());
            }
            core.sources
                .page(url.as_str(), "mangadex", &core.settings()?)
                .await?
        }
        source if source.starts_with("ext:") => {
            core.sources
                .page(&book.cover, source, &core.settings()?)
                .await?
        }
        _ => return Err("Unknown cover source".into()),
    };
    let thumbnail = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>> {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        let image = reader
            .decode()
            .map_err(|e| e.to_string())?
            .thumbnail(256, 360)
            .to_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 80)
            .encode_image(&image)
            .map_err(|e| e.to_string())?;
        Ok(jpeg)
    })
    .await
    .map_err(|e| e.to_string())??;
    tokio::fs::create_dir_all(cache.parent().ok_or("Invalid cover cache path")?)
        .await
        .map_err(|e| e.to_string())?;
    let temporary = cache.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    tokio::fs::write(&temporary, &thumbnail)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(temporary, cache)
        .await
        .map_err(|e| e.to_string())?;
    Ok(thumbnail)
}
#[tauri::command]
fn save_progress(
    core: State<Arc<Core>>,
    book_id: String,
    chapter_id: String,
    page: usize,
    completed: bool,
    total_pages: Option<usize>,
) -> Result<()> {
    let mut b = core.store.book(&book_id)?;
    if !b.chapters.iter().any(|c| c.id == chapter_id) {
        return Err("Chapter not found".into());
    }
    if let Some(total) = total_pages {
        if total == 0 || total > 100_000 {
            return Err("Invalid PDF page count".into());
        }
        let chapter = b.chapters.iter_mut().find(|c| c.id == chapter_id).unwrap();
        if b.source != "local" || !chapter.path.to_lowercase().ends_with(".pdf") {
            return Err("Only local PDF documents may report a page count".into());
        }
        if chapter.pages != total {
            chapter.pages = total;
            core.store.put(&b)?;
        }
    }
    core.store.save_progress(&Progress {
        book_id,
        chapter_id,
        page,
        completed,
        updated: now_ms(),
    })
}
#[tauri::command]
fn save_settings(core: State<Arc<Core>>, mut settings: Settings) -> Result<Snapshot> {
    if !matches!(
        settings.language.as_str(),
        "en" | "es" | "es-la" | "pt-br" | "fr" | "ja" | "de" | "it"
    ) {
        return Err("Unsupported language".into());
    }
    if !settings.komga_password.is_empty() {
        crate::credentials::Entry::new("Mreader.Komga", &settings.komga_url)
            .map_err(|e| e.to_string())?
            .set_password(&settings.komga_password)
            .map_err(|e| format!("Cannot save credentials in Windows Credential Manager: {e}"))?
    }
    settings.komga_password.clear();
    core.store.save_settings(&settings)?;
    core.manifests.lock().map_err(|e| e.to_string())?.clear();
    core.snapshot()
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadEvent {
    book_id: String,
    chapter_id: String,
    done: usize,
    total: usize,
}
#[tauri::command]
async fn download_chapter(
    app: tauri::AppHandle,
    core: State<'_, Arc<Core>>,
    book_id: String,
    chapter_id: String,
) -> Result<Book> {
    let key = format!("{book_id}:{chapter_id}");
    {
        let mut active = core.downloads.lock().map_err(|e| e.to_string())?;
        if !active.insert(key.clone()) {
            return Err("This chapter is already downloading".into());
        }
        if active.len() > 2 {
            active.remove(&key);
            return Err("Two chapters are already downloading. Wait for one to finish.".into());
        }
    }
    let result = download(Some(&app), core.inner(), &book_id, &chapter_id).await;
    core.downloads
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&key);
    result
}
async fn download(
    app: Option<&tauri::AppHandle>,
    core: &Arc<Core>,
    book_id: &str,
    chapter_id: &str,
) -> Result<Book> {
    let b = core.store.book(book_id)?;
    let c = b
        .chapters
        .iter()
        .find(|c| c.id == chapter_id)
        .ok_or("Chapter not found")?;
    if b.source == "local" || c.downloaded {
        return Ok(b);
    }
    let manifest = core.manifest(&b, c).await?;
    let cfg = core.settings()?;
    let downloads = core.data.join("downloads");
    tokio::fs::create_dir_all(&downloads)
        .await
        .map_err(|e| e.to_string())?;
    let temp = downloads.join(format!("{}.partial", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&temp)
        .await
        .map_err(|e| e.to_string())?;
    let total = manifest.urls.len();
    if let Some(app) = app {
        let _ = app.emit(
            "download-progress",
            DownloadEvent {
                book_id: book_id.into(),
                chapter_id: chapter_id.into(),
                done: 0,
                total,
            },
        );
    }
    let failed = std::sync::atomic::AtomicBool::new(false);
    let mut tasks = stream::iter(manifest.urls.into_iter().enumerate().map(|(i, url)| {
        let cfg = &cfg;
        let source = &b.source;
        let temp = &temp;
        let failed = &failed;
        async move {
            if failed.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Download cancelled after a page failure".into());
            }
            let result = async {
                let bytes = core.sources.page(&url, source, cfg).await?;
                tokio::fs::write(temp.join(format!("{i:05}.jpg")), bytes)
                    .await
                    .map_err(|e| e.to_string())
            }
            .await;
            if result.is_err() {
                failed.store(true, std::sync::atomic::Ordering::Relaxed)
            }
            result
        }
    }))
    .buffer_unordered(3);
    let mut done = 0;
    let mut first_error = None;
    while let Some(r) = tasks.next().await {
        if let Err(e) = r {
            if first_error.is_none() {
                first_error = Some(e)
            }
            continue;
        }
        done += 1;
        if let Some(app) = app {
            let _ = app.emit(
                "download-progress",
                DownloadEvent {
                    book_id: book_id.into(),
                    chapter_id: chapter_id.into(),
                    done,
                    total,
                },
            );
        }
    }
    drop(tasks);
    if let Some(error) = first_error {
        tokio::fs::remove_dir_all(&temp)
            .await
            .map_err(|e| format!("{error}. Temporary download cleanup failed: {e}"))?;
        return Err(error);
    }
    let final_path = downloads.join(uuid::Uuid::new_v4().to_string());
    tokio::fs::rename(&temp, &final_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut current = core.store.book(book_id)?;
    let target = current
        .chapters
        .iter_mut()
        .find(|c| c.id == chapter_id)
        .ok_or("Chapter was removed while downloading")?;
    target.path = final_path.to_string_lossy().into();
    target.pages = total;
    target.downloaded = true;
    core.store.put(&current)?;
    Ok(current)
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn export_backup(core: State<'_, Arc<Core>>) -> Result<bool> {
    let data = serde_json::to_vec_pretty(&core.snapshot()?).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(path) = rfd::FileDialog::new()
            .set_file_name("mreader-backup.json")
            .add_filter("JSON", &["json"])
            .save_file()
        {
            std::fs::write(path, data).map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(not(target_os = "android"))]
#[tauri::command]
async fn restore_backup(core: State<'_, Arc<Core>>) -> Result<Snapshot> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Mreader backup", &["json"])
            .pick_file()
        else {
            return core.snapshot();
        };
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
            return Err("Backup is too large".into());
        }
        #[derive(serde::Deserialize)]
        struct Backup {
            books: Vec<Book>,
            progress: Vec<Progress>,
            settings: Settings,
        }
        let backup: Backup =
            serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Invalid backup: {e}"))?;
        let mut validated = Vec::new();
        for mut book in backup.books {
            if book.source == "local" && !book.path.is_empty() {
                let mut checked = core.local.import(&PathBuf::from(&book.path))?;
                checked.id = book.id.clone();
                checked.favorite = book.favorite;
                for c in &mut checked.chapters {
                    if let Some(old) = book.chapters.iter().find(|old| old.path == c.path) {
                        c.id = old.id.clone()
                    }
                }
                book = checked
            } else {
                let extension = book.source.strip_prefix("ext:");
                if let Some(id) = extension {
                    core.sources.extensions.get(id)?;
                } else if !matches!(book.source.as_str(), "mangadex" | "komga" | "local") {
                    return Err("Backup contains an unknown source".into());
                }
                if extension.is_none() && book.source != "local" {
                    sources::valid_id(&book.remote_id)?;
                }
                book.path.clear();
                for c in &mut book.chapters {
                    if extension.is_none() && book.source != "local" {
                        sources::valid_id(&c.id)?;
                    }
                    c.path.clear();
                    c.downloaded = false
                }
            }
            validated.push(book);
        }
        let progress: Vec<Progress> = backup
            .progress
            .into_iter()
            .filter_map(|mut p| {
                let chapter = validated
                    .iter()
                    .find(|b| b.id == p.book_id)?
                    .chapters
                    .iter()
                    .find(|c| c.id == p.chapter_id)?;
                p.page = p.page.min(chapter.pages.saturating_sub(1));
                Some(p)
            })
            .collect();
        let mut cfg = backup.settings;
        cfg.komga_password.clear();
        core.store.merge(&validated, &progress, &cfg)?;
        core.manifests.lock().map_err(|e| e.to_string())?.clear();
        core.snapshot()
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn extension_list(core: State<Arc<Core>>) -> Result<Vec<extensions::Extension>> {
    core.sources.extensions.list()
}
#[tauri::command]
async fn extension_install(
    core: State<'_, Arc<Core>>,
    manifest: extensions::Extension,
) -> Result<Vec<extensions::Extension>> {
    let _guard = core.cloud.gate.lock().await;
    let id = manifest.id.clone();
    if serde_json::to_vec(&manifest)
        .map_err(|e| e.to_string())?
        .len()
        > 128 * 1024
    {
        return Err("Extension manifest exceeds 128 KiB".into());
    }
    core.sources.extensions.install(manifest)?;
    core.store.mark("extension", &id)?;
    core.sources.extensions.list()
}
#[tauri::command]
async fn extension_example(core: State<'_, Arc<Core>>) -> Result<Vec<extensions::Extension>> {
    let manifest = serde_json::from_str(include_str!("../../extensions/mangadex.mreader.json"))
        .map_err(|e| e.to_string())?;
    extension_install(core, manifest).await
}
#[tauri::command]
async fn extension_remove(
    core: State<'_, Arc<Core>>,
    id: String,
) -> Result<Vec<extensions::Extension>> {
    let _guard = core.cloud.gate.lock().await;
    core.sources.extensions.remove(&id)?;
    core.store.mark("deleted", &format!("extension:{id}"))?;
    core.manifests.lock().map_err(|e| e.to_string())?.clear();
    core.sources.extensions.list()
}
#[tauri::command]
fn cloud_status(core: State<Arc<Core>>) -> Result<serde_json::Value> {
    core.cloud.status()
}
#[tauri::command]
async fn cloud_configure(
    core: State<'_, Arc<Core>>,
    url: String,
    public_key: String,
) -> Result<serde_json::Value> {
    let _guard = core.cloud.gate.lock().await;
    core.cloud.configure(&url, &public_key)?;
    core.cloud.status()
}
fn switch_profile(core: &Core) -> Result<()> {
    if !core.downloads.lock().map_err(|e| e.to_string())?.is_empty() {
        return Err("Wait for downloads to finish before switching accounts".into());
    }
    let dir = core.cloud.profile_dir(&core.data)?;
    core.store.switch(&dir.join("library.sqlite"))?;
    core.sources.extensions.set_dir(&dir.join("extensions"))?;
    core.local.clear_indexes()?;
    core.manifests.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}
#[tauri::command]
async fn cloud_auth(
    core: State<'_, Arc<Core>>,
    email: String,
    password: String,
    register: bool,
) -> Result<serde_json::Value> {
    let _guard = core.cloud.gate.lock().await;
    if !core.downloads.lock().map_err(|e| e.to_string())?.is_empty() {
        return Err("Wait for downloads to finish before switching accounts".into());
    }
    let signed_in = core
        .cloud
        .authenticate(&core.cloud.client, &email, &password, register)
        .await?;
    if signed_in {
        switch_profile(&core)?;
    }
    Ok(
        serde_json::json!({"confirmationRequired":!signed_in,"status":core.cloud.status()?,"snapshot":core.snapshot()?}),
    )
}
#[tauri::command]
async fn cloud_logout(core: State<'_, Arc<Core>>) -> Result<Snapshot> {
    let _guard = core.cloud.gate.lock().await;
    if !core.downloads.lock().map_err(|e| e.to_string())?.is_empty() {
        return Err("Wait for downloads to finish before signing out".into());
    }
    core.cloud.logout(&core.cloud.client).await?;
    switch_profile(&core)?;
    core.snapshot()
}
#[tauri::command]
async fn cloud_sync(core: State<'_, Arc<Core>>) -> Result<serde_json::Value> {
    let _guard = core.cloud.gate.lock().await;
    let local = cloud::Document::from_store(&core.store, core.sources.extensions.list()?)?;
    let committed = core.cloud.exchange(&core.cloud.client, &local).await?;
    let latest = cloud::Document::from_store(&core.store, core.sources.extensions.list()?)?;
    let merged = latest.merge(&committed)?;
    for entry in merged.extensions.values() {
        core.sources.extensions.install(entry.value.clone())?;
    }
    for key in merged.deletions.keys() {
        if let Some(id) = key.strip_prefix("extension:") {
            if core.sources.extensions.get(id).is_ok() {
                core.sources.extensions.remove(id)?;
            }
        }
    }
    merged.apply(&core.store)?;
    core.cloud.synced()?;
    Ok(
        serde_json::json!({"snapshot":core.snapshot()?,"status":core.cloud.status()?,"extensions":core.sources.extensions.list()?}),
    )
}
#[tauri::command]
fn verification_plan(core: State<Arc<Core>>) -> Result<serde_json::Value> {
    if core.verification.is_none() {
        return Ok(serde_json::json!({"enabled":false}));
    }
    let files = std::env::var("MREADER_VERIFY_FILES").unwrap_or("[]".into());
    let files: Vec<String> = serde_json::from_str(&files).map_err(|e| e.to_string())?;
    Ok(
        serde_json::json!({"enabled":true,"files":files,"display":std::env::var("MREADER_DISPLAY").unwrap_or_default(),"offline":std::env::var("MREADER_VERIFY_OFFLINE").as_deref()==Ok("1")}),
    )
}
#[tauri::command]
fn verification_finish(
    app: tauri::AppHandle,
    core: State<Arc<Core>>,
    report: serde_json::Value,
) -> Result<()> {
    let path = core
        .verification
        .as_ref()
        .ok_or("Verification is not enabled")?;
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.exit(if report["ok"] == true { 0 } else { 1 });
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    #[cfg(not(target_os = "android"))]
    if let Some(window) = context.config_mut().app.windows.first_mut() {
        window.focus = false;
        window.visible = false;
    }
    tauri::Builder::default()
        .setup(|app| {
            let data = if let Some(path) = std::env::var_os("MREADER_DATA_DIR") {
                PathBuf::from(path)
            } else {
                app.path().app_data_dir()?
            };
            let core = Core::new(data).map_err(std::io::Error::other)?;
            app.manage(Arc::new(core));
            #[cfg(not(target_os = "android"))]
            if let Some(window) = app.get_webview_window("main") {
                if std::env::var("MREADER_DISPLAY").as_deref() == Ok("2") {
                    let monitors = window.available_monitors()?;
                    let target = monitors
                        .iter()
                        .find(|m| m.name().map(|n| n.ends_with("DISPLAY2")).unwrap_or(false))
                        .or_else(|| monitors.get(1))
                        .ok_or_else(|| {
                            std::io::Error::other(
                                "Display 2 is unavailable; refusing to open on display 1",
                            )
                        })?;
                    let pos = target.position();
                    window.set_position(tauri::PhysicalPosition::new(pos.x + 40, pos.y + 40))?;
                }
                window.set_focusable(false)?;
                window.show()?;
                window.set_focusable(true)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            search_source,
            add_book,
            remove_book,
            favorite,
            chapters,
            import_files,
            import_paths,
            import_bytes,
            open_chapter,
            page_data,
            cover_data,
            save_progress,
            save_settings,
            download_chapter,
            export_backup,
            restore_backup,
            extension_list,
            extension_install,
            extension_remove,
            extension_example,
            cloud_status,
            cloud_configure,
            cloud_auth,
            cloud_logout,
            cloud_sync,
            verification_plan,
            verification_finish
        ])
        .run(context)
        .expect("Mreader failed to start");
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn reimport_preserves_progress_and_database_survives_restart() {
        let root = std::env::temp_dir().join(format!("mreader-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("Chapter 1.cbz");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        zip.start_file("001.png", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"fixture page").unwrap();
        zip.finish().unwrap();
        let core = Core::new(root.join("data")).unwrap();
        import_into(&core, vec![archive.clone()]).unwrap();
        let mut book = core.store.books().unwrap().remove(0);
        book.favorite = true;
        core.store.put(&book).unwrap();
        let progress = Progress {
            book_id: book.id.clone(),
            chapter_id: book.chapters[0].id.clone(),
            page: 0,
            completed: true,
            updated: now(),
        };
        core.store.save_progress(&progress).unwrap();
        import_into(&core, vec![archive]).unwrap();
        let books = core.store.books().unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(books[0].chapters[0].id, progress.chapter_id);
        assert!(books[0].favorite);
        drop(core);
        let reopened = Core::new(root.join("data")).unwrap();
        assert_eq!(reopened.store.progress().unwrap().len(), 1);
        assert!(reopened.store.progress().unwrap()[0].completed);
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn passwords_never_serialize_into_backups_or_settings() {
        let mut cfg = Settings::default();
        cfg.komga_password = "test-secret-never-export".into();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("test-secret"));
        assert!(!json.contains("komgaPassword"));
    }

    fn exercise_download(fail_page: bool) {
        use std::{io::Read, net::TcpListener};
        let root = std::env::temp_dir().join(format!("mreader-download-{}", uuid::Uuid::new_v4()));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let start = std::time::Instant::now();
            let mut handled = 0;
            while handled < 4 && start.elapsed() < Duration::from_secs(15) {
                let (mut socket, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buf = [0; 2048];
                while !bytes.windows(4).any(|b| b == b"\r\n\r\n") {
                    let n = socket.read(&mut buf).unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buf[..n]);
                }
                let request = String::from_utf8_lossy(&bytes);
                let path = request.split_whitespace().nth(1).unwrap();
                let (status, body) = if path == "/api/v1/books/chapter/pages" {
                    ("200 OK", r#"[{"number":1},{"number":2},{"number":3}]"#)
                } else if fail_page && path.ends_with("/2") {
                    ("404 Not Found", "missing")
                } else {
                    ("200 OK", "page bytes")
                };
                let _=write!(socket,"HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}",body.len());
                handled += 1;
            }
        });
        let core = Arc::new(Core::new(root.clone()).unwrap());
        let mut cfg = Settings::default();
        cfg.komga_url = format!("http://{address}");
        core.store.save_settings(&cfg).unwrap();
        let book:Book=serde_json::from_value(serde_json::json!({"id":"komga:series","title":"Offline test","source":"komga","remoteId":"series","chapters":[{"id":"chapter","title":"Test","number":"1","pages":3}]})).unwrap();
        core.store.put(&book).unwrap();
        let result = tauri::async_runtime::block_on(download(None, &core, &book.id, "chapter"));
        if fail_page {
            assert!(result.is_err());
            assert!(!core.store.book(&book.id).unwrap().chapters[0].downloaded);
            assert_eq!(
                std::fs::read_dir(root.join("downloads")).unwrap().count(),
                0
            )
        } else {
            let book = result.unwrap();
            assert!(book.chapters[0].downloaded);
            assert_eq!(
                core.local.read(&book.chapters[0].path, 2).unwrap(),
                b"page bytes"
            );
            assert_eq!(
                std::fs::read_dir(root.join("downloads")).unwrap().count(),
                1
            )
        }
        server.join().unwrap();
        drop(core);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn chapter_download_is_readable_offline_after_completion() {
        exercise_download(false)
    }
    #[test]
    fn failed_download_never_becomes_offline_and_cleans_partial_pages() {
        exercise_download(true)
    }

    #[test]
    #[ignore = "Uses the live MangaDex API and downloads one page"]
    fn live_mangadex() {
        tauri::async_runtime::block_on(async {
            let source = sources::Sources::new().unwrap();
            let settings = Settings::default();
            let catalog = source.search("mangadex", "", 0, &settings).await.unwrap();
            assert!(!catalog.books.is_empty(), "Live catalog returned no titles");
            let discovery = source
                .json(
                    source
                        .client
                        .get("https://api.mangadex.org/chapter")
                        .query(&[
                            ("limit", "1"),
                            ("translatedLanguage[]", "en"),
                            ("includeEmptyPages", "0"),
                            ("includeFutureUpdates", "0"),
                            ("order[createdAt]", "desc"),
                        ]),
                )
                .await
                .unwrap();
            let chapter_id = discovery["data"][0]["id"].as_str().unwrap();
            let manga_id = discovery["data"][0]["relationships"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["type"] == "manga")
                .unwrap()["id"]
                .as_str()
                .unwrap();
            let manga = source
                .json(
                    source
                        .client
                        .get(format!("https://api.mangadex.org/manga/{manga_id}")),
                )
                .await
                .unwrap();
            let book = sources::parse_md_book(&manga["data"]);
            let chapters = source.chapters(&book, &settings).await.unwrap();
            assert!(!chapters.is_empty(), "No live English chapters");
            let manifest = source
                .manifest(
                    &book,
                    chapters
                        .iter()
                        .find(|c| c.id == chapter_id)
                        .unwrap_or(&chapters[0]),
                    &settings,
                )
                .await
                .unwrap();
            let bytes = source
                .page(&manifest.urls[0], "mangadex", &settings)
                .await
                .unwrap();
            assert!(bytes.len() > 1000);
            assert!(
                image::load_from_memory(&bytes).is_ok(),
                "Source did not return a decodable image"
            );
            println!(
                "LIVE PASS: {} / {} chapters / {} pages in first chapter / {} image bytes",
                book.title,
                chapters.len(),
                manifest.urls.len(),
                bytes.len()
            );
        });
    }
}
