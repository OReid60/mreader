//! Executable Android extensions are isolated behind a source-runtime boundary.
#[cfg(not(target_os = "android"))]
mod desktop;
pub mod index;
mod runtime;
use crate::model::{Book, Catalog, Chapter};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
type Result<T> = std::result::Result<T, String>;
const KEI: &str = "[user-supplied repository URL]";
const KEI_KEY: &str = "9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub url: String,
    pub catalog: index::Catalog,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub extension: index::Extension,
    pub repository: String,
    pub signing_key: String,
}
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub repositories: Vec<Repository>,
    pub installed: Vec<Installed>,
}
pub struct Engine {
    dir: Mutex<Option<PathBuf>>,
    state: Mutex<State>,
    runtime: runtime::Runtime,
    gate: tokio::sync::Mutex<()>,
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            dir: Mutex::new(None),
            state: Mutex::new(State::default()),
            runtime: runtime::Runtime::default(),
            gate: tokio::sync::Mutex::new(()),
        }
    }
}
pub fn https_url(text: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(text).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Extension repository resources must use HTTPS without credentials".into());
    }
    Ok(url)
}
async fn download(url: &str, limit: usize) -> Result<Vec<u8>> {
    https_url(url)?;
    let client = reqwest::Client::builder()
        .user_agent("Mreader/0.4")
        .https_only(true)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > limit {
            return Err("Extension download is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
impl Engine {
    pub fn stop(&self) {
        self.runtime.stop();
    }
    pub fn set_dir(&self, dir: &Path) -> Result<()> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let state = if dir.join("state.json").exists() {
            serde_json::from_slice(
                &std::fs::read(dir.join("state.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| format!("Invalid APK registry: {e}"))?
        } else {
            State::default()
        };
        *self.dir.lock().map_err(|e| e.to_string())? = Some(dir.to_owned());
        *self.state.lock().map_err(|e| e.to_string())? = state;
        self.runtime.set_dir(dir)?;
        Ok(())
    }
    fn dir(&self) -> Result<PathBuf> {
        self.dir
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("APK runtime is not initialized".into())
    }
    pub fn state(&self) -> Result<State> {
        Ok(self.state.lock().map_err(|e| e.to_string())?.clone())
    }
    fn save(&self, state: State) -> Result<State> {
        let dir = self.dir()?;
        let bytes = serde_json::to_vec(&state).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("state.tmp"), bytes).map_err(|e| e.to_string())?;
        std::fs::rename(dir.join("state.tmp"), dir.join("state.json"))
            .map_err(|e| e.to_string())?;
        *self.state.lock().map_err(|e| e.to_string())? = state.clone();
        Ok(state)
    }
    pub async fn repository(&self, url: String, trust_key: Option<String>) -> Result<State> {
        let _guard = self.gate.lock().await;
        let url = if matches!(
            url.trim_end_matches('/'),
            "[user-supplied repository URL]"
                | "[user-supplied repository URL]"
                | "[user-supplied repository URL]"
        ) {
            KEI.to_string()
        } else {
            url
        };
        let bytes = download(&url, 4 * 1024 * 1024).await?;
        let catalog = index::decode(&bytes)?;
        let mut state = self.state()?;
        let known = state
            .repositories
            .iter()
            .find(|r| r.url == url)
            .map(|r| r.catalog.signing_key.as_str())
            .or(if url == KEI { Some(KEI_KEY) } else { None });
        let expected = known.or(trust_key.as_deref()).ok_or_else(|| {
            format!(
                "Trust this repository fingerprint first: {}",
                catalog.signing_key
            )
        })?;
        if expected != catalog.signing_key {
            return Err(format!(
                "Repository signing key changed: {}",
                catalog.signing_key
            ));
        }
        state.repositories.retain(|r| r.url != url);
        state.repositories.push(Repository { url, catalog });
        self.save(state)
    }
    pub async fn install(&self, repository: String, package: String) -> Result<State> {
        let _guard = self.gate.lock().await;
        let mut state = self.state()?;
        let repo = state
            .repositories
            .iter()
            .find(|r| r.url == repository)
            .ok_or("Add this repository first")?;
        let ext = repo
            .catalog
            .extensions
            .iter()
            .find(|e| e.package == package)
            .ok_or("Extension is not in this repository")?
            .clone();
        if let Some(old) = state
            .installed
            .iter()
            .find(|e| e.extension.package == package)
        {
            if old.signing_key != repo.catalog.signing_key {
                return Err("Cannot change an installed APK's signing identity".into());
            }
            if ext.version_code < old.extension.version_code {
                return Err("APK version downgrade rejected".into());
            }
        }
        let record = Installed {
            extension: ext.clone(),
            repository: repository.clone(),
            signing_key: repo.catalog.signing_key.clone(),
        };
        let path = self
            .dir()?
            .join(format!("{}-{}.apk", ext.package, ext.version_code));
        let bytes = download(&ext.apk_url, 64 * 1024 * 1024).await?;
        let temp = path.with_extension("download");
        std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        let backup = path.with_extension("previous");
        let had_previous = path.exists();
        if had_previous {
            std::fs::rename(&path, &backup).map_err(|e| e.to_string())?;
        }
        if let Err(e) = std::fs::rename(&temp, &path) {
            if had_previous {
                let _ = std::fs::rename(&backup, &path);
            }
            return Err(e.to_string());
        }
        // Never mark installed until signature validation AND source loading succeed.
        let result=self.runtime.call(json!({"operation":"install","path":path,"package":ext.package,"versionCode":ext.version_code,"signingKey":record.signing_key,"repository":repository})).await;
        if let Err(error) = result {
            let _ = std::fs::remove_file(&path);
            if had_previous {
                let _ = std::fs::rename(&backup, &path);
            }
            return Err(error);
        }
        if had_previous {
            let _ = std::fs::remove_file(backup);
        }
        state.installed.retain(|e| e.extension.package != package);
        state.installed.push(record);
        self.save(state)
    }
    pub async fn remove(&self, package: String) -> Result<State> {
        let _guard = self.gate.lock().await;
        let mut state = self.state()?;
        self.runtime
            .call(json!({"operation":"remove","package":package}))
            .await?;
        for record in state
            .installed
            .iter()
            .filter(|e| e.extension.package == package)
        {
            let path = self
                .dir()?
                .join(format!("{}-{}.apk", package, record.extension.version_code));
            let _ = std::fs::remove_file(path);
        }
        state.installed.retain(|e| e.extension.package != package);
        self.save(state)
    }
    async fn ready(&self, id: &str) -> Result<()> {
        let e = self
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .installed
            .iter()
            .find(|e| e.extension.sources.iter().any(|s| s.id == id))
            .cloned()
            .ok_or("Install this APK extension on this device before reading synced titles")?;
        self.runtime.load(&e, &self.dir()?).await
    }
    pub async fn search(&self, id: &str, query: &str, page: usize) -> Result<Catalog> {
        self.ready(id).await?;
        let v = self
            .runtime
            .call(json!({"operation":"search","sourceId":id,"query":query,"page":page}))
            .await?;
        let rows = v["mangas"]
            .as_array()
            .ok_or("Invalid extension search result")?;
        let books = rows
            .iter()
            .map(|m| book(id, m))
            .collect::<Result<Vec<_>>>()?;
        let total = books.len()
            + if v["hasNextPage"].as_bool().unwrap_or(false) {
                1
            } else {
                0
            };
        Ok(Catalog { books, total })
    }
    pub async fn chapters(&self, b: &Book) -> Result<Vec<Chapter>> {
        let id = b.source.strip_prefix("apk:").ok_or("Invalid APK source")?;
        self.ready(id).await?;
        let v = self
            .runtime
            .call(json!({"operation":"chapters","sourceId":id,"url":b.remote_id,"title":b.title}))
            .await?;
        let rows = v["chapters"]
            .as_array()
            .ok_or("Invalid extension chapter list")?;
        let mut chapters = rows
            .iter()
            .map(|c| {
                Ok(Chapter {
                    id: required(c, "url")?,
                    title: string(c, "title"),
                    number: string(c, "number"),
                    group: string(c, "group"),
                    pages: 0,
                    path: String::new(),
                    downloaded: false,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        chapters.sort_by(|a, b| {
            a.number
                .parse::<f64>()
                .unwrap_or(-1.0)
                .total_cmp(&b.number.parse::<f64>().unwrap_or(-1.0))
        });
        Ok(chapters)
    }
    pub async fn manifest(&self, b: &Book, c: &Chapter) -> Result<crate::sources::Manifest> {
        let id = b.source.strip_prefix("apk:").ok_or("Invalid APK source")?;
        self.ready(id).await?;
        let v=self.runtime.call(json!({"operation":"pages","sourceId":id,"url":c.id,"title":c.title,"mangaUrl":b.remote_id,"mangaTitle":b.title})).await?;
        let rows = v.as_array().ok_or("Invalid extension page list")?;
        if rows.is_empty() {
            return Err("This extension returned no readable pages".into());
        }
        Ok(crate::sources::Manifest {
            urls: rows
                .iter()
                .map(|p| serde_json::to_string(p).unwrap())
                .collect(),
            created: Instant::now(),
        })
    }
    pub async fn image(&self, source: &str, url: &str) -> Result<Vec<u8>> {
        let id = source.strip_prefix("apk:").ok_or("Invalid APK source")?;
        self.ready(id).await?;
        let page = if url.starts_with('{') {
            serde_json::from_str::<Value>(url).map_err(|e| e.to_string())?
        } else {
            json!({"imageUrl":url,"url":"","index":0})
        };
        self.runtime
            .image(json!({"operation":"image","sourceId":id,"page":page}))
            .await
    }
}
fn string(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or_default().to_string()
}
fn required(v: &Value, k: &str) -> Result<String> {
    let s = string(v, k);
    if s.is_empty() || s.len() > 8192 {
        Err(format!("Extension returned invalid {k}"))
    } else {
        Ok(s)
    }
}
fn book(id: &str, v: &Value) -> Result<Book> {
    let url = required(v, "url")?;
    let hash = format!("{:x}", Sha256::digest(url.as_bytes()));
    let title = required(v, "title")?;
    let cover = json!({"mangaUrl":url,"mangaTitle":title}).to_string();
    Ok(Book {
        id: format!("apk:{id}:{hash}"),
        source: format!("apk:{id}"),
        remote_id: url,
        title,
        author: string(v, "author"),
        description: string(v, "description"),
        cover,
        path: String::new(),
        status: String::new(),
        tags: string(v, "genre")
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect(),
        chapters: vec![],
        favorite: false,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn portable_identity_and_cover_do_not_contain_runtime_row_ids() {
        let a=book("1998944621602463790",&json!({"url":"#/titles/100274","title":"Kagurabachi","cover":"/api/v1/manga/3/thumbnail"})).unwrap();
        let b=book("1998944621602463790",&json!({"url":"#/titles/100274","title":"Kagurabachi","cover":"https://publisher.test/other.jpg"})).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.cover, b.cover);
        assert!(!a.cover.contains("/api/"));
        assert_ne!(
            a.id,
            book(
                "2499283573021220255",
                &json!({"url":"#/titles/100274","title":"Kagurabachi"})
            )
            .unwrap()
            .id
        );
    }
    #[test]
    #[ignore = "Live signed Keiyoushi APK / local JVM / publisher network smoke test"]
    fn live_keiyoushi_kagurabachi() {
        tauri::async_runtime::block_on(async {
            let dir =
                std::env::temp_dir().join(format!("mreader-apk-smoke-{}", uuid::Uuid::new_v4()));
            let engine = Engine::default();
            engine.set_dir(&dir).unwrap();
            let catalog = engine.repository(KEI.into(), None).await.unwrap();
            assert!(catalog.repositories[0].catalog.extensions.len() > 1000);
            let extension=catalog.repositories[0].catalog.extensions.iter().find(|e|e.package=="eu.kanade.tachiyomi.extension.all.mangaplus").unwrap();
            let subscription=crate::source_sync::Subscription{package:extension.package.clone(),name:extension.name.clone(),repository:KEI.into(),signing_key:catalog.repositories[0].catalog.signing_key.clone(),version_code:extension.version_code};
            let choices=std::collections::BTreeMap::from([(format!("apk:{}",extension.package),crate::cloud::Timed{value:crate::source_sync::Choice::Apk(subscription),updated_at:1})]);
            assert!(crate::source_sync::prepare(&engine,&choices,&Default::default()).await.is_empty());
            let installed=std::fs::read(dir.join("state.json")).unwrap();
            assert!(crate::source_sync::prepare(&engine,&choices,&Default::default()).await.is_empty());
            assert_eq!(std::fs::read(dir.join("state.json")).unwrap(),installed);
            let results = engine
                .search("1998944621602463790", "Kagurabachi", 1)
                .await
                .unwrap();
            let mut book = results
                .books
                .into_iter()
                .find(|b| b.title == "Kagurabachi")
                .unwrap();
            book.chapters = engine.chapters(&book).await.unwrap();
            assert!(!book.chapters.is_empty());
            let manifest = engine.manifest(&book, &book.chapters[0]).await.unwrap();
            assert!(manifest.urls.len() >= 8);
            let bytes = engine.image(&book.source, &manifest.urls[0]).await.unwrap();
            assert!(image::load_from_memory(&bytes).is_ok());
            let bytes = engine.image(&book.source, &book.cover).await.unwrap();
            assert!(image::load_from_memory(&bytes).is_ok());
            println!(
                "LIVE APK PASS: {} / {} chapters / {} pages / stable {}",
                book.title,
                book.chapters.len(),
                manifest.urls.len(),
                book.id
            );
            drop(engine);
            let _ = std::fs::remove_dir_all(dir);
        });
    }
}
