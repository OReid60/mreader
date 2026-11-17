//! Portable, declarative JSON API extensions. No executable scripts or native libraries.
use crate::{
    model::*,
    sources::{Manifest, Sources},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Extension {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub language: String,
    pub base_url: String,
    pub allowed_hosts: Vec<String>,
    pub search: Endpoint,
    pub chapters: Endpoint,
    pub pages: Pages,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Endpoint {
    pub path: String,
    pub items: String,
    #[serde(default)]
    pub total: Option<String>,
    pub fields: BTreeMap<String, Field>,
    #[serde(default)]
    pub templates: BTreeMap<String, String>,
    #[serde(default = "batch")]
    pub batch_size: usize,
}
fn batch() -> usize {
    100
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Field {
    Pointer(String),
    Select(Select),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Select {
    pub path: String,
    #[serde(default)]
    pub localized: bool,
    #[serde(default)]
    pub where_field: Option<String>,
    #[serde(default)]
    pub equals: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pages {
    pub path: String,
    pub items: String,
    pub fields: BTreeMap<String, Field>,
    pub template: String,
}
#[derive(Default)]
pub struct Registry(Mutex<RegistryState>);
#[derive(Default)]
struct RegistryState {
    dir: Option<PathBuf>,
    items: BTreeMap<String, Extension>,
}
impl Registry {
    pub fn set_dir(&self, dir: &Path) -> Result<()> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let mut items = BTreeMap::new();
        for e in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let p = e.map_err(|e| e.to_string())?.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
            if bytes.len() > 128 * 1024 {
                return Err("Extension manifest is too large".into());
            }
            let ext: Extension = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid extension {}: {e}", p.display()))?;
            ext.validate()?;
            items.insert(ext.id.clone(), ext);
        }
        *self.0.lock().map_err(|e| e.to_string())? = RegistryState {
            dir: Some(dir.to_owned()),
            items,
        };
        Ok(())
    }
    pub fn list(&self) -> Result<Vec<Extension>> {
        Ok(self
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .items
            .values()
            .cloned()
            .collect())
    }
    pub fn get(&self, id: &str) -> Result<Extension> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .items
            .get(id)
            .cloned()
            .ok_or_else(|| {
                format!("Extension {id} is not installed. Install its manifest in Settings.")
            })
    }
    pub fn install(&self, ext: Extension) -> Result<()> {
        ext.validate()?;
        let mut state = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(dir) = &state.dir {
            let path = dir.join(format!("{}.json", ext.id));
            let temp = dir.join(format!("{}.tmp", ext.id));
            std::fs::write(
                &temp,
                serde_json::to_vec_pretty(&ext).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            std::fs::rename(temp, path).map_err(|e| e.to_string())?;
        }
        state.items.insert(ext.id.clone(), ext);
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        let mut state = self.0.lock().map_err(|e| e.to_string())?;
        if !state.items.contains_key(id) {
            return Err("Extension is not installed".into());
        }
        if let Some(dir) = &state.dir {
            std::fs::remove_file(dir.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
        }
        state.items.remove(id);
        Ok(())
    }
}
fn mapping(fields: &BTreeMap<String, Field>, node: &Value) -> BTreeMap<String, String> {
    fields
        .iter()
        .map(|(k, v)| (k.clone(), v.read(node)))
        .collect()
}
impl Field {
    fn read(&self, node: &Value) -> String {
        let v = match self {
            Self::Pointer(p) => node.pointer(p),
            Self::Select(s) => {
                let mut v = node.pointer(&s.path);
                if let Some(field) = &s.where_field {
                    v = v.and_then(Value::as_array).and_then(|arr| {
                        arr.iter().find(|v| {
                            v.pointer(field).and_then(Value::as_str) == s.equals.as_deref()
                        })
                    });
                }
                if let Some(p) = &s.value {
                    v = v.and_then(|v| v.pointer(p));
                }
                if s.localized {
                    return v
                        .and_then(|v| {
                            v.get("en").and_then(Value::as_str).or_else(|| {
                                v.as_object()
                                    .and_then(|o| o.values().find_map(Value::as_str))
                            })
                        })
                        .unwrap_or("")
                        .into();
                }
                v
            }
        };
        match v {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    }
}
fn expand(template: &str, values: &BTreeMap<String, String>, encode: bool) -> Result<String> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let end = tail
            .find('}')
            .ok_or("Unclosed extension template placeholder")?;
        let key = &tail[..end];
        let value = values
            .get(key)
            .ok_or_else(|| format!("Unknown extension template field: {key}"))?;
        if encode {
            out.push_str(
                &percent_encoding::utf8_percent_encode(value, percent_encoding::NON_ALPHANUMERIC)
                    .to_string(),
            )
        } else {
            out.push_str(value)
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    if out.contains('}') {
        return Err("Invalid extension template".into());
    }
    Ok(out)
}
impl Extension {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err("Unsupported extension schema version".into());
        }
        if self.id.is_empty()
            || self.id.len() > 100
            || !self.id.bytes().all(|b| {
                b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_')
            })
        {
            return Err(
                "Extension ID must contain lowercase letters, digits, dots, hyphens or underscores"
                    .into(),
            );
        }
        if self.name.trim().is_empty()
            || self.version.is_empty()
            || self.allowed_hosts.is_empty()
            || self.allowed_hosts.len() > 20
        {
            return Err("Extension metadata is incomplete".into());
        }
        self.check_url(&self.base_url)?;
        for p in [&self.search.path, &self.chapters.path, &self.pages.path] {
            if !p.starts_with('/') || p.starts_with("//") || p.contains('#') {
                return Err("Extension endpoint paths must start with a single slash".into());
            }
        }
        for ep in [&self.search, &self.chapters] {
            if ep.batch_size == 0 || ep.batch_size > 500 || !ep.fields.contains_key("id") {
                return Err(
                    "Extension endpoints need an id field and batchSize from 1 to 500".into(),
                );
            }
        }
        Ok(())
    }
    pub fn check_url(&self, url: &str) -> Result<()> {
        let url = reqwest::Url::parse(url).map_err(|_| "Invalid extension URL")?;
        let host = url.host_str().ok_or("Missing extension host")?;
        if !self.allowed_hosts.iter().any(|h| {
            h == host
                || h.strip_prefix("*.")
                    .map(|suffix| host.ends_with(&format!(".{suffix}")))
                    .unwrap_or(false)
        }) || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Extension URL is outside its declared host permissions".into());
        }
        if url.scheme() != "https"
            && !(url.scheme() == "http" && matches!(host, "127.0.0.1" | "localhost" | "[::1]"))
        {
            return Err("Extensions require HTTPS (except loopback testing)".into());
        }
        Ok(())
    }
    fn url(&self, path: &str, args: &BTreeMap<String, String>) -> Result<String> {
        let url = format!(
            "{}{}",
            self.base_url.trim_end_matches('/'),
            expand(path, args, true)?
        );
        self.check_url(&url)?;
        Ok(url)
    }
    pub async fn search(
        &self,
        sources: &Sources,
        query: &str,
        offset: usize,
        language: &str,
    ) -> Result<Catalog> {
        let args = BTreeMap::from([
            ("query".into(), query.into()),
            ("offset".into(), offset.to_string()),
            (
                "page".into(),
                (offset / self.search.batch_size + 1).to_string(),
            ),
            ("limit".into(), self.search.batch_size.to_string()),
            ("language".into(), language.into()),
        ]);
        let json = sources
            .extension_json(self, &self.url(&self.search.path, &args)?)
            .await?;
        let items = json
            .pointer(&self.search.items)
            .and_then(Value::as_array)
            .ok_or("Extension search items must be a JSON array")?;
        let mut books = Vec::new();
        for item in items {
            let mut v = mapping(&self.search.fields, item);
            for (k, t) in &self.search.templates {
                v.insert(k.clone(), expand(t, &v, false)?);
            }
            let id = v.get("id").cloned().unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let cover = v.get("cover").cloned().unwrap_or_default();
            if !cover.is_empty() {
                self.check_url(&cover)?;
            }
            books.push(Book {
                id: format!("ext:{}:{id}", self.id),
                remote_id: id,
                title: v.get("title").cloned().unwrap_or("Untitled".into()),
                author: v.get("author").cloned().unwrap_or_default(),
                description: v.get("description").cloned().unwrap_or_default(),
                cover,
                source: format!("ext:{}", self.id),
                path: String::new(),
                status: v.get("status").cloned().unwrap_or_default(),
                tags: vec![self.name.clone()],
                chapters: Vec::new(),
                favorite: false,
        custom_cover: None,
            });
        }
        let total = self
            .search
            .total
            .as_ref()
            .and_then(|p| json.pointer(p))
            .and_then(Value::as_u64)
            .map(|n| n as usize)
            .unwrap_or(offset + books.len());
        Ok(Catalog { books, total })
    }
    pub async fn chapters(
        &self,
        sources: &Sources,
        book: &Book,
        language: &str,
    ) -> Result<Vec<Chapter>> {
        let mut offset = 0;
        let mut chapters = Vec::new();
        let mut publisher_links = 0;
        loop {
            let args = BTreeMap::from([
                ("id".into(), book.remote_id.clone()),
                ("offset".into(), offset.to_string()),
                (
                    "page".into(),
                    (offset / self.chapters.batch_size + 1).to_string(),
                ),
                ("limit".into(), self.chapters.batch_size.to_string()),
                ("language".into(), language.into()),
            ]);
            let json = sources
                .extension_json(self, &self.url(&self.chapters.path, &args)?)
                .await?;
            let items = json
                .pointer(&self.chapters.items)
                .and_then(Value::as_array)
                .ok_or("Extension chapter items must be a JSON array")?;
            for item in items {
                // MangaDex's external entries contain publisher URLs, not hosted pages.
                if self.base_url.trim_end_matches('/') == "https://api.mangadex.org"
                    && !item["attributes"]["externalUrl"]
                        .as_str()
                        .unwrap_or("")
                        .is_empty()
                {
                    publisher_links += 1;
                    continue;
                }
                let v = mapping(&self.chapters.fields, item);
                let id = v.get("id").cloned().unwrap_or_default();
                if id.is_empty() {
                    continue;
                }
                chapters.push(Chapter {
                    id,
                    title: v.get("title").cloned().unwrap_or_default(),
                    number: v.get("number").cloned().unwrap_or_default(),
                    pages: v.get("pages").and_then(|s| s.parse().ok()).unwrap_or(0),
                    path: String::new(),
                    downloaded: false,
                    source_memo:None,group: v.get("group").cloned().unwrap_or_else(|| self.name.clone()),
                });
            }
            offset += items.len();
            let total = self
                .chapters
                .total
                .as_ref()
                .and_then(|p| json.pointer(p))
                .and_then(Value::as_u64)
                .unwrap_or(offset as u64) as usize;
            if items.is_empty() || offset >= total || offset >= 10000 {
                break;
            }
        }
        if chapters.is_empty() && publisher_links > 0 {
            return Err(format!("MangaDex lists {publisher_links} publisher links in {language}, but does not host their pages. Read on the publisher’s website or select a different installed source."));
        }
        Ok(chapters)
    }
    pub async fn manifest(
        &self,
        sources: &Sources,
        book: &Book,
        chapter: &Chapter,
    ) -> Result<Manifest> {
        let args = BTreeMap::from([
            ("id".into(), book.remote_id.clone()),
            ("chapter".into(), chapter.id.clone()),
        ]);
        let json = sources
            .extension_json(self, &self.url(&self.pages.path, &args)?)
            .await?;
        let mut fields = mapping(&self.pages.fields, &json);
        let files = json
            .pointer(&self.pages.items)
            .and_then(Value::as_array)
            .ok_or("Extension page items must be a JSON array")?;
        let mut urls = Vec::new();
        for f in files {
            fields.insert(
                "file".into(),
                f.as_str()
                    .ok_or("Extension pages must be URL strings or filenames")?
                    .into(),
            );
            let url = expand(&self.pages.template, &fields, false)?;
            self.check_url(&url)?;
            urls.push(url)
        }
        if urls.is_empty() {
            return Err("This chapter has no hosted pages".into());
        }
        Ok(Manifest {
            urls,
            created: Instant::now(),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_encodes_query_data() {
        let v = BTreeMap::from([("query".into(), "a&b / ?".into())]);
        assert_eq!(
            expand("/search?q={query}", &v, true).unwrap(),
            "/search?q=a%26b%20%2F%20%3F"
        );
        assert!(expand("{unknown}", &v, true).is_err());
    }
    #[test]
    fn fields_find_relationship_and_localize() {
        let f:Field=serde_json::from_value(serde_json::json!({"path":"/relationships","whereField":"/type","equals":"cover_art","value":"/attributes/fileName"})).unwrap();
        assert_eq!(f.read(&serde_json::json!({"relationships":[{"type":"author"},{"type":"cover_art","attributes":{"fileName":"cover.jpg"}}]})),"cover.jpg");
    }
    #[test]
    fn validates_host_permissions_and_rejects_scripts() {
        let e: Extension =
            serde_json::from_str(include_str!("../../tests/fixtures/native-source.json")).unwrap();
        e.validate().unwrap();
        assert!(e.check_url("https://evil.example/image").is_err());
        assert!(e.check_url("http://api.example.invalid/image").is_err());
        let mut v = serde_json::to_value(e).unwrap();
        v["script"] = Value::String("alert(1)".into());
        assert!(serde_json::from_value::<Extension>(v).is_err());
    }
    #[test]
    fn redirects_cannot_escape_extension_permissions() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 2048];
            let _ = socket.read(&mut bytes).unwrap();
            socket.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://outside.invalid/page\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        tauri::async_runtime::block_on(async {
            let sources = Sources::new().unwrap();
            let mut extension: Extension =
                serde_json::from_str(include_str!("../../tests/fixtures/native-source.json"))
                    .unwrap();
            extension.base_url = format!("http://{address}");
            extension.allowed_hosts = vec!["127.0.0.1".into()];
            let id = extension.id.clone();
            sources.extensions.install(extension).unwrap();
            let error = sources
                .page(
                    &format!("http://{address}/redirect"),
                    &format!("ext:{id}"),
                    &Settings::default(),
                )
                .await
                .unwrap_err();
            assert!(error.contains("host permissions"));
        });
        server.join().unwrap();
    }
}
