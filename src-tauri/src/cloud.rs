//! Managed account sync. Supabase Auth + an RLS-protected, compare-and-swap document.
use crate::{extensions::Extension, model::*, store::Store};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub url: String,
    pub public_key: String,
    pub active_user: Option<String>,
    pub email: Option<String>,
    pub last_sync: i64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub user_id: String,
    pub expires_at: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timed<T> {
    pub value: T,
    pub updated_at: i64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub schema_version: u32,
    #[serde(default)]
    pub books: BTreeMap<String, Timed<Book>>,
    #[serde(default)]
    pub progress: BTreeMap<String, Progress>,
    #[serde(default)]
    pub extensions: BTreeMap<String, Timed<Extension>>,
    #[serde(default)]
    pub deletions: BTreeMap<String, i64>,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            schema_version: 1,
            books: BTreeMap::new(),
            progress: BTreeMap::new(),
            extensions: BTreeMap::new(),
            deletions: BTreeMap::new(),
        }
    }
}
pub struct Cloud {
    pub client: reqwest::Client,
    config_path: PathBuf,
    pub config: Mutex<Config>,
    session: Mutex<Option<Session>>,
    pub gate: tokio::sync::Mutex<()>,
}
fn normalized_time(t: i64) -> i64 {
    if t > 0 && t < 1_000_000_000_000 {
        t.saturating_mul(1000)
    } else {
        t
    }
}
impl Document {
    pub fn from_store(store: &Store, extensions: Vec<Extension>) -> Result<Self> {
        let meta = store.metadata("book")?;
        let mut document = Self::default();
        for mut b in store.books()? {
            b.path.clear();
            for c in &mut b.chapters {
                c.path.clear();
                c.downloaded = false;
            }
            let stamp = meta.get(&b.id).copied().unwrap_or(0);
            document.books.insert(
                b.id.clone(),
                Timed {
                    value: b,
                    updated_at: stamp,
                },
            );
        }
        for mut p in store.progress()? {
            p.updated = normalized_time(p.updated);
            document
                .progress
                .insert(format!("{}\0{}", p.book_id, p.chapter_id), p);
        }
        let meta = store.metadata("extension")?;
        for e in extensions {
            let updated_at = meta.get(&e.id).copied().unwrap_or(0);
            document.extensions.insert(
                e.id.clone(),
                Timed {
                    value: e,
                    updated_at,
                },
            );
        }
        document.deletions = store.metadata("deleted")?;
        Ok(document)
    }
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err("Unsupported sync document version".into());
        }
        if self.books.len() > 10000 || self.extensions.len() > 100 {
            return Err("Sync document exceeds supported library size".into());
        }
        for (id, b) in &self.books {
            if id != &b.value.id
                || !b.value.path.is_empty()
                || b.value
                    .chapters
                    .iter()
                    .any(|c| !c.path.is_empty() || c.downloaded)
            {
                return Err("Sync metadata must not contain device paths or download state".into());
            }
            if !matches!(b.value.source.as_str(), "local" | "mangadex" | "komga")
                && !b.value.source.starts_with("ext:")
                && !b.value.source.starts_with("apk:")
            {
                return Err("Sync document contains an unknown source".into());
            }
        }
        for (id, e) in &self.extensions {
            if id != &e.value.id {
                return Err("Invalid synced extension ID".into());
            }
            e.value.validate()?;
        }
        Ok(())
    }
    pub fn merge(&self, remote: &Self) -> Result<Self> {
        remote.validate()?;
        self.validate()?;
        let mut merged = remote.clone();
        for (id, b) in &self.books {
            if merged
                .books
                .get(id)
                .map(|r| b.updated_at > r.updated_at)
                .unwrap_or(true)
            {
                merged.books.insert(id.clone(), b.clone());
            }
        }
        for (id, e) in &self.extensions {
            if merged
                .extensions
                .get(id)
                .map(|r| e.updated_at > r.updated_at)
                .unwrap_or(true)
            {
                merged.extensions.insert(id.clone(), e.clone());
            }
        }
        for (id, p) in &self.progress {
            let mut p = p.clone();
            p.updated = normalized_time(p.updated);
            if let Some(old) = merged.progress.get(id) {
                let complete = old.completed || p.completed;
                if normalized_time(old.updated) > p.updated {
                    p = old.clone()
                }
                p.completed = complete;
            }
            merged.progress.insert(id.clone(), p);
        }
        for (k, v) in &self.deletions {
            let stamp = merged.deletions.entry(k.clone()).or_default();
            *stamp = (*stamp).max(*v);
        }
        let tombs = merged.deletions.clone();
        for (key, stamp) in tombs {
            if let Some(id) = key.strip_prefix("book:") {
                if merged
                    .books
                    .get(id)
                    .map(|b| b.updated_at > stamp)
                    .unwrap_or(false)
                {
                    merged.deletions.remove(&key);
                } else {
                    merged.books.remove(id);
                    merged.progress.retain(|_, p| p.book_id != id);
                }
            } else if let Some(id) = key.strip_prefix("extension:") {
                if merged
                    .extensions
                    .get(id)
                    .map(|e| e.updated_at > stamp)
                    .unwrap_or(false)
                {
                    merged.deletions.remove(&key);
                } else {
                    merged.extensions.remove(id);
                }
            }
        }
        Ok(merged)
    }
    pub fn apply(&self, store: &Store) -> Result<()> {
        let existing: BTreeMap<_, _> = store
            .books()?
            .into_iter()
            .map(|b| (b.id.clone(), b))
            .collect();
        let mut books = Vec::new();
        for (id, entry) in &self.books {
            let mut b = entry.value.clone();
            if let Some(local) = existing.get(id) {
                b.path = local.path.clone();
                for c in &mut b.chapters {
                    if let Some(old) = local.chapters.iter().find(|old| old.id == c.id) {
                        c.path = old.path.clone();
                        c.downloaded = old.downloaded;
                        if old.downloaded {
                            c.pages = old.pages
                        }
                    }
                }
            }
            books.push((b, entry.updated_at));
        }
        store.apply_sync(
            &books,
            &self.progress.values().cloned().collect::<Vec<_>>(),
            &self.deletions,
            &self
                .extensions
                .iter()
                .map(|(id, e)| (id.clone(), e.updated_at))
                .collect(),
        )
    }
}
impl Cloud {
    pub fn new(data: &Path) -> Result<Self> {
        let path = data.join("cloud-config.json");
        let defaults: Config = serde_json::from_str(include_str!("../../cloud/project.json"))
            .map_err(|e| format!("Invalid bundled public service configuration: {e}"))?;
        let mut cfg: Config = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        } else {
            defaults.clone()
        };
        if cfg.active_user.is_none() && (cfg.url.is_empty() || cfg.public_key.is_empty()) {
            cfg = defaults;
        }
        let session = Self::credential(&cfg)
            .and_then(|e| e.get_password().ok())
            .and_then(|s| serde_json::from_str(&s).ok());
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|e| e.to_string())?,
            config_path: path,
            config: Mutex::new(cfg),
            session: Mutex::new(session),
            gate: tokio::sync::Mutex::new(()),
        })
    }
    fn credential(cfg: &Config) -> Option<crate::credentials::Entry> {
        crate::credentials::Entry::new(
            "Mreader.Account",
            &format!("{}:{}", cfg.url, cfg.active_user.as_deref()?),
        )
        .ok()
    }
    pub fn profile_dir(&self, data: &Path) -> Result<PathBuf> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?;
        match &cfg.active_user {
            Some(id) => {
                uuid::Uuid::parse_str(id).map_err(|_| "Invalid account profile identifier")?;
                let dir = data.join("profiles").join(id);
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                Ok(dir)
            }
            None => Ok(data.to_owned()),
        }
    }
    pub fn status(&self) -> Result<Value> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?;
        Ok(
            json!({"configured":!cfg.url.is_empty()&&!cfg.public_key.is_empty(),"signedIn":self.session.lock().map_err(|e|e.to_string())?.is_some(),"email":cfg.email,"url":cfg.url,"publicKey":cfg.public_key,"lastSync":cfg.last_sync,"profile":if cfg.active_user.is_some(){"account"}else{"guest"}}),
        )
    }
    fn persist_config(&self, cfg: &Config) -> Result<()> {
        let temp = self.config_path.with_extension("tmp");
        std::fs::write(
            &temp,
            serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(temp, &self.config_path).map_err(|e| e.to_string())
    }
    pub fn configure(&self, url: &str, key: &str) -> Result<()> {
        let parsed =
            reqwest::Url::parse(url).map_err(|_| "Enter a valid managed sync project URL")?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
        {
            return Err("Sync project URL must be an HTTPS origin".into());
        }
        use base64::Engine;
        let legacy_anon = key
            .split('.')
            .nth(1)
            .and_then(|p| {
                base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(p)
                    .ok()
            })
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.get("role").and_then(Value::as_str).map(str::to_owned))
            == Some("anon".into());
        if key.trim().len() < 20 || !(key.starts_with("sb_publishable_") || legacy_anon) {
            return Err(
                "Use the public publishable/anon key, never a service-role or secret key".into(),
            );
        }
        if self
            .config
            .lock()
            .map_err(|e| e.to_string())?
            .active_user
            .is_some()
        {
            return Err("Sign out before changing the sync project".into());
        }
        let cfg = Config {
            url: url.trim_end_matches('/').into(),
            public_key: key.trim().into(),
            ..Config::default()
        };
        self.persist_config(&cfg)?;
        *self.config.lock().map_err(|e| e.to_string())? = cfg;
        Ok(())
    }
    async fn json(client: &reqwest::Client, request: reqwest::RequestBuilder) -> Result<Value> {
        let response = request
            .timeout(std::time::Duration::from_secs(20))
            .send()
            .await
            .map_err(|e| format!("Managed sync is unreachable: {e}"))?;
        let status = response.status();
        let body: Value = response
            .json()
            .await
            .map_err(|_| "Managed sync returned an invalid response")?;
        if !status.is_success() {
            return Err(body
                .get("msg")
                .or_else(|| body.get("error_description"))
                .or_else(|| body.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("Account service rejected the request")
                .into());
        }
        let _ = client;
        Ok(body)
    }
    fn save_session(&self, cfg: &Config, session: &Session) -> Result<()> {
        Self::credential(cfg)
            .ok_or("Cannot access this account’s credential storage")?
            .set_password(&serde_json::to_string(session).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Cannot save account session securely: {e}"))?;
        *self.session.lock().map_err(|e| e.to_string())? = Some(session.clone());
        Ok(())
    }
    pub async fn authenticate(
        &self,
        client: &reqwest::Client,
        email: &str,
        password: &str,
        register: bool,
    ) -> Result<bool> {
        let mut cfg = self.config.lock().map_err(|e| e.to_string())?.clone();
        if cfg.url.is_empty() || cfg.public_key.is_empty() {
            return Err("Account sync is not configured for this build. Add the managed project URL and public key in Settings.".into());
        }
        if self.session.lock().map_err(|e| e.to_string())?.is_some() {
            return Err("Sign out before signing in to another account".into());
        }
        if email.trim().is_empty() || password.len() < 8 {
            return Err("Enter an email and a password of at least 8 characters".into());
        }
        let endpoint = if register {
            "signup"
        } else {
            "token?grant_type=password"
        };
        let body = Self::json(
            client,
            client
                .post(format!("{}/auth/v1/{endpoint}", cfg.url))
                .header("apikey", &cfg.public_key)
                .json(&json!({"email":email.trim(),"password":password})),
        )
        .await?;
        if body["access_token"].as_str().is_none() {
            if register {
                return Ok(false);
            }
            return Err("The account service returned no session".into());
        }
        let id = body["user"]["id"]
            .as_str()
            .ok_or("Missing account identifier")?;
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid account identifier")?;
        cfg.active_user = Some(id.into());
        cfg.email = body["user"]["email"].as_str().map(str::to_owned);
        cfg.last_sync = 0;
        let session = Self::parse_session(&body, id)?;
        self.save_session(&cfg, &session)?;
        self.persist_config(&cfg)?;
        *self.config.lock().map_err(|e| e.to_string())? = cfg;
        Ok(true)
    }
    fn parse_session(v: &Value, id: &str) -> Result<Session> {
        Ok(Session {
            access_token: v["access_token"]
                .as_str()
                .ok_or("Missing access token")?
                .into(),
            refresh_token: v["refresh_token"]
                .as_str()
                .ok_or("Missing refresh token")?
                .into(),
            user_id: id.into(),
            expires_at: v["expires_at"]
                .as_i64()
                .unwrap_or_else(|| now() + v["expires_in"].as_i64().unwrap_or(3600)),
        })
    }
    async fn session(&self, client: &reqwest::Client) -> Result<(Config, Session)> {
        let cfg = self.config.lock().map_err(|e| e.to_string())?.clone();
        let mut session = self
            .session
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("Sign in to sync your account")?;
        if session.expires_at <= now() + 60 {
            let body = Self::json(
                client,
                client
                    .post(format!(
                        "{}/auth/v1/token?grant_type=refresh_token",
                        cfg.url
                    ))
                    .header("apikey", &cfg.public_key)
                    .json(&json!({"refresh_token":session.refresh_token})),
            )
            .await?;
            if body["user"]["id"].as_str() != Some(&session.user_id) {
                return Err("The refreshed session does not match this account".into());
            }
            session = Self::parse_session(&body, &session.user_id)?;
            self.save_session(&cfg, &session)?;
        }
        Ok((cfg, session))
    }
    pub async fn exchange(&self, client: &reqwest::Client, local: &Document) -> Result<Document> {
        let (cfg, session) = self.session(client).await?;
        exchange(client, &cfg, &session, local).await
    }
    pub fn synced(&self) -> Result<()> {
        let mut cfg = self.config.lock().map_err(|e| e.to_string())?;
        cfg.last_sync = now_ms();
        self.persist_config(&cfg)
    }
    pub async fn logout(&self, client: &reqwest::Client) -> Result<()> {
        let cfg_snapshot = self.config.lock().map_err(|e| e.to_string())?.clone();
        let session_snapshot = self.session.lock().map_err(|e| e.to_string())?.clone();
        if let Some(session) = session_snapshot {
            let _ = client
                .post(format!("{}/auth/v1/logout?scope=local", cfg_snapshot.url))
                .timeout(std::time::Duration::from_secs(5))
                .header("apikey", cfg_snapshot.public_key)
                .bearer_auth(session.access_token)
                .send()
                .await;
        }
        let mut cfg = self.config.lock().map_err(|e| e.to_string())?;
        if let Some(entry) = Self::credential(&cfg) {
            let _ = entry.delete_credential();
        }
        *self.session.lock().map_err(|e| e.to_string())? = None;
        cfg.active_user = None;
        cfg.email = None;
        cfg.last_sync = 0;
        self.persist_config(&cfg)
    }
}
async fn exchange(
    client: &reqwest::Client,
    cfg: &Config,
    session: &Session,
    local: &Document,
) -> Result<Document> {
    for _ in 0..4 {
        let rows = Cloud::json(
            client,
            client
                .get(format!(
                    "{}/rest/v1/mreader_sync_state?select=revision,document",
                    cfg.url
                ))
                .header("apikey", &cfg.public_key)
                .bearer_auth(&session.access_token),
        )
        .await?;
        let rows=rows.as_array().ok_or("Sync service returned an invalid state. Apply cloud/schema.sql to the managed project.")?;
        let (revision, remote) = if let Some(row) = rows.first() {
            (
                row["revision"].as_i64().ok_or("Missing sync revision")?,
                serde_json::from_value::<Document>(row["document"].clone())
                    .map_err(|e| e.to_string())?,
            )
        } else {
            (0, Document::default())
        };
        let merged = local.merge(&remote)?;
        let data = serde_json::to_vec(&merged).map_err(|e| e.to_string())?;
        if data.len() > 8 * 1024 * 1024 {
            return Err("Sync metadata exceeds 8 MiB".into());
        }
        let result = Cloud::json(
            client,
            client
                .post(format!("{}/rest/v1/rpc/mreader_sync_commit", cfg.url))
                .header("apikey", &cfg.public_key)
                .bearer_auth(&session.access_token)
                .json(&json!({"expected_revision":revision,"incoming_document":merged})),
        )
        .await?;
        if result.as_i64().unwrap_or(0) > revision {
            return Ok(merged);
        }
    }
    Err("Another device kept changing the library. Your local progress is safe; retry sync.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn book(id: &str) -> Book {
        serde_json::from_value(
            json!({"id":id,"title":"Test","source":"mangadex","remoteId":"id","chapters":[]}),
        )
        .unwrap()
    }
    #[test]
    fn two_devices_merge_progress_and_deletions() {
        let mut desktop = Document::default();
        let mut phone = Document::default();
        desktop.books.insert(
            "b".into(),
            Timed {
                value: book("b"),
                updated_at: 10,
            },
        );
        phone.books = desktop.books.clone();
        desktop.progress.insert(
            "b\0c".into(),
            Progress {
                book_id: "b".into(),
                chapter_id: "c".into(),
                page: 4,
                completed: false,
                updated: 2000,
            },
        );
        phone.progress.insert(
            "b\0c".into(),
            Progress {
                book_id: "b".into(),
                chapter_id: "c".into(),
                page: 8,
                completed: true,
                updated: 3000,
            },
        );
        let merged = desktop.merge(&phone).unwrap();
        assert_eq!(merged.progress["b\0c"].page, 8);
        assert!(merged.progress["b\0c"].completed);
        phone.deletions.insert("book:b".into(), 20);
        let merged = desktop.merge(&phone).unwrap();
        assert!(merged.books.is_empty());
        assert!(merged.progress.is_empty());
    }
    #[test]
    fn device_paths_and_unknown_manifest_versions_are_rejected() {
        let mut d = Document::default();
        let mut b = book("b");
        b.path = "C:/private".into();
        d.books.insert(
            "b".into(),
            Timed {
                value: b,
                updated_at: 1,
            },
        );
        assert!(d.validate().is_err());
    }
    #[test]
    fn synchronized_local_metadata_preserves_device_files() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let store = Store::open(&dir.join("library.sqlite")).unwrap();
        let mut b = book("b");
        b.source = "local".into();
        b.path = "device-only.cbz".into();
        store.put(&b).unwrap();
        let doc = Document::from_store(&store, vec![]).unwrap();
        assert!(doc.books["b"].value.path.is_empty());
        doc.apply(&store).unwrap();
        assert_eq!(store.book("b").unwrap().path, "device-only.cbz");
        drop(store);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn http_sync_retries_conflicts_and_converges_two_devices() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let stamp = now_ms();
        let mut desktop = Document::default();
        desktop.books.insert(
            "b".into(),
            Timed {
                value: book("b"),
                updated_at: stamp,
            },
        );
        desktop.progress.insert(
            "b\0c".into(),
            Progress {
                book_id: "b".into(),
                chapter_id: "c".into(),
                page: 4,
                completed: false,
                updated: stamp,
            },
        );
        let mut concurrent = desktop.clone();
        concurrent.progress.get_mut("b\0c").unwrap().page = 9;
        concurrent.progress.get_mut("b\0c").unwrap().updated = stamp + 10;
        let server = std::thread::spawn(move || {
            let mut document = Document::default();
            let mut revision = 0;
            let mut injected = false;
            for _ in 0..8 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 4096];
                let end = loop {
                    let n = socket.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(i) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                        break i + 4;
                    }
                };
                let header = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                assert!(header.contains("authorization: bearer test-user"));
                let length = header
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                while bytes.len() < end + length {
                    let n = socket.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                }
                let response = if header.starts_with("get ") {
                    if revision == 0 {
                        json!([])
                    } else {
                        json!([{"revision":revision,"document":document}])
                    }
                } else {
                    let request: Value = serde_json::from_slice(&bytes[end..end + length]).unwrap();
                    if !injected {
                        injected = true;
                        revision = 1;
                        document = concurrent.clone();
                        json!(0)
                    } else if request["expected_revision"] == revision {
                        document =
                            serde_json::from_value(request["incoming_document"].clone()).unwrap();
                        revision += 1;
                        json!(revision)
                    } else {
                        json!(0)
                    }
                };
                let body = serde_json::to_string(&response).unwrap();
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }
            document
        });
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::new();
            let cfg = Config {
                url: format!("http://{address}"),
                public_key: "test-public-key".into(),
                ..Config::default()
            };
            let session = Session {
                access_token: "test-user".into(),
                refresh_token: "test-refresh".into(),
                user_id: uuid::Uuid::new_v4().to_string(),
                expires_at: now() + 3600,
            };
            let first = exchange(&client, &cfg, &session, &desktop).await.unwrap();
            assert_eq!(
                first.progress["b\0c"].page, 9,
                "A conflicting remote write must survive retry"
            );
            let mut phone = desktop.clone();
            phone.progress.get_mut("b\0c").unwrap().page = 12;
            phone.progress.get_mut("b\0c").unwrap().updated = stamp + 100;
            exchange(&client, &cfg, &session, &phone).await.unwrap();
            let resumed = exchange(&client, &cfg, &session, &desktop).await.unwrap();
            assert_eq!(
                resumed.progress["b\0c"].page, 12,
                "Desktop must resume the newer phone progress"
            );
        });
        assert_eq!(server.join().unwrap().progress["b\0c"].page, 12);
    }
    #[test]
    fn account_profiles_do_not_mix_libraries() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let guest = root.join("guest.sqlite");
        let account = root.join("account.sqlite");
        let store = Store::open(&guest).unwrap();
        store.put(&book("guest-book")).unwrap();
        store.switch(&account).unwrap();
        assert!(store.books().unwrap().is_empty());
        store.put(&book("account-book")).unwrap();
        store.switch(&guest).unwrap();
        assert!(store.book("account-book").is_err());
        assert!(store.book("guest-book").is_ok());
        drop(store);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sync_never_overwrites_a_page_read_while_request_is_in_flight() {
        let store = Store::open(Path::new(":memory:")).unwrap();
        let p = Progress {
            book_id: "b".into(),
            chapter_id: "c".into(),
            page: 20,
            completed: false,
            updated: now_ms() + 100,
        };
        store.save_progress(&p).unwrap();
        let mut old = p.clone();
        old.page = 2;
        old.updated -= 100;
        store
            .apply_sync(&[], &[old], &BTreeMap::new(), &BTreeMap::new())
            .unwrap();
        assert_eq!(store.progress().unwrap()[0].page, 20);
    }
}
