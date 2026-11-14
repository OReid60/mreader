use crate::model::*;
use futures_util::StreamExt;
use reqwest::{Client, RequestBuilder};
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
type Result<T> = std::result::Result<T, String>;
pub struct Sources {
    pub client: Client,
    restricted: Client,
    pub extensions: crate::extensions::Registry,
    gate: Mutex<Instant>,
}
#[derive(Clone)]
pub struct Manifest {
    pub urls: Vec<String>,
    pub created: Instant,
}
fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}
fn localized(v: &Value) -> String {
    v.get("en")
        .and_then(Value::as_str)
        .or_else(|| {
            v.as_object()
                .and_then(|o| o.values().find_map(Value::as_str))
        })
        .unwrap_or_default()
        .to_string()
}
pub fn valid_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 120
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        Err("Invalid source identifier".into())
    } else {
        Ok(())
    }
}
impl Sources {
    pub fn new() -> Result<Self> {
        Ok(Self {
            restricted: Client::builder()
                .user_agent("Mreader/0.3")
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(90))
                .build()
                .map_err(|e| e.to_string())?,
            extensions: crate::extensions::Registry::default(),
            client: Client::builder()
                .user_agent("Mreader/0.2 (desktop manga reader)")
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(4)
                .build()
                .map_err(|e| e.to_string())?,
            gate: Mutex::new(Instant::now() - Duration::from_secs(1)),
        })
    }
    async fn extension_response(
        &self,
        extension: &crate::extensions::Extension,
        url: &str,
    ) -> Result<reqwest::Response> {
        let mut target = url.to_owned();
        for _ in 0..6 {
            extension.check_url(&target)?;
            let response = self
                .restricted
                .get(&target)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|h| h.to_str().ok())
                    .ok_or("Extension redirect has no location")?;
                target = reqwest::Url::parse(&target)
                    .map_err(|e| e.to_string())?
                    .join(location)
                    .map_err(|e| e.to_string())?
                    .to_string();
                continue;
            }
            return Ok(response);
        }
        Err("Too many extension redirects".into())
    }
    pub async fn extension_json(
        &self,
        extension: &crate::extensions::Extension,
        url: &str,
    ) -> Result<Value> {
        let mut gate = self.gate.lock().await;
        tokio::time::sleep(Duration::from_millis(230).saturating_sub(gate.elapsed())).await;
        *gate = Instant::now();
        let response = self.extension_response(extension, url).await?;
        if !response.status().is_success() {
            return Err(format!(
                "Extension source returned HTTP {}",
                response.status()
            ));
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err("Extension JSON exceeds 8 MiB".into());
            }
            bytes.extend_from_slice(&chunk)
        }
        serde_json::from_slice(&bytes)
            .map_err(|e| format!("Extension source returned invalid JSON: {e}"))
    }
    async fn md(&self, path: &str, query: &[(&str, String)]) -> Result<Value> {
        let mut gate = self.gate.lock().await;
        let wait = Duration::from_millis(230).saturating_sub(gate.elapsed());
        tokio::time::sleep(wait).await;
        *gate = Instant::now();
        let req = self
            .client
            .get(format!("https://api.mangadex.org{path}"))
            .query(query);
        self.json(req).await
    }
    pub async fn json(&self, request: RequestBuilder) -> Result<Value> {
        let response = request
            .send()
            .await
            .map_err(|e| format!("Cannot reach source: {e}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(match status.as_u16() {
                401 | 403 => {
                    "Source denied access. Check credentials or source availability.".into()
                }
                429 => "Source rate limit reached. Wait a minute and retry.".into(),
                _ => format!("Source returned HTTP {status}"),
            });
        }
        response
            .json()
            .await
            .map_err(|e| format!("Source returned an invalid response: {e}"))
    }
    pub fn komga(&self, cfg: &Settings, path: &str) -> Result<RequestBuilder> {
        let base = cfg.komga_url.trim_end_matches('/');
        let url =
            reqwest::Url::parse(base).map_err(|_| "Enter your Komga server URL in Settings")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
        {
            return Err(
                "Komga URL must be an HTTP(S) server address without embedded credentials".into(),
            );
        }
        Ok(self
            .client
            .get(format!("{base}/api/v1{path}"))
            .basic_auth(&cfg.komga_user, Some(&cfg.komga_password)))
    }
    pub async fn search(
        &self,
        source: &str,
        query: &str,
        offset: usize,
        cfg: &Settings,
    ) -> Result<Catalog> {
        if let Some(id) = source.strip_prefix("ext:") {
            return self
                .extensions
                .get(id)?
                .search(self, query, offset, &cfg.language)
                .await;
        }
        match source {
            "mangadex" => {
                let mut q = vec![
                    ("limit", "24".into()),
                    ("offset", offset.to_string()),
                    ("includes[]", "cover_art".into()),
                    ("includes[]", "author".into()),
                    ("contentRating[]", "safe".into()),
                    ("contentRating[]", "suggestive".into()),
                    ("availableTranslatedLanguage[]", cfg.language.clone()),
                    ("order[followedCount]", "desc".into()),
                ];
                if !query.trim().is_empty() {
                    q.push(("title", query.trim().into()))
                }
                let v = self.md("/manga", &q).await?;
                let books = v["data"]
                    .as_array()
                    .ok_or("Invalid MangaDex catalog response")?
                    .iter()
                    .map(parse_md_book)
                    .collect();
                Ok(Catalog {
                    books,
                    total: v["total"].as_u64().unwrap_or(0) as usize,
                })
            }
            "komga" => {
                let r = self.komga(cfg, "/series")?.query(&[
                    ("search", query.to_string()),
                    ("size", "24".into()),
                    ("page", (offset / 24).to_string()),
                    ("sort", "metadata.titleSort,asc".into()),
                ]);
                let v = self.json(r).await?;
                let books = v["content"]
                    .as_array()
                    .ok_or("Invalid Komga series response")?
                    .iter()
                    .map(parse_komga_book)
                    .collect();
                Ok(Catalog {
                    books,
                    total: v["totalElements"].as_u64().unwrap_or(0) as usize,
                })
            }
            _ => Err("Unknown source".into()),
        }
    }
    pub async fn chapters(&self, b: &Book, cfg: &Settings) -> Result<Vec<Chapter>> {
        if let Some(id) = b.source.strip_prefix("ext:") {
            return self
                .extensions
                .get(id)?
                .chapters(self, b, &cfg.language)
                .await;
        }
        valid_id(&b.remote_id)?;
        let mut chapters = Vec::new();
        let mut offset = 0;
        loop {
            let previous_offset = offset;
            let (rows, total) = if b.source == "mangadex" {
                let v = self
                    .md(
                        &format!("/manga/{}/feed", b.remote_id),
                        &[
                            ("limit", "500".into()),
                            ("offset", offset.to_string()),
                            ("translatedLanguage[]", cfg.language.clone()),
                            ("order[volume]", "asc".into()),
                            ("order[chapter]", "asc".into()),
                            ("includes[]", "scanlation_group".into()),
                            ("includeEmptyPages", "0".into()),
                            ("includeFutureUpdates", "0".into()),
                        ],
                    )
                    .await?;
                let rows = v["data"]
                    .as_array()
                    .ok_or("Invalid chapter feed")?
                    .iter()
                    .filter(|v| {
                        v["attributes"]["pages"].as_u64().unwrap_or(0) > 0
                            && v["attributes"]["externalUrl"]
                                .as_str()
                                .unwrap_or("")
                                .is_empty()
                    })
                    .map(parse_md_chapter)
                    .collect::<Vec<_>>();
                let count = v["data"].as_array().map(|x| x.len()).unwrap_or(0);
                offset += count;
                (rows, v["total"].as_u64().unwrap_or(0) as usize)
            } else {
                let v = self
                    .json(
                        self.komga(cfg, &format!("/series/{}/books", b.remote_id))?
                            .query(&[
                                ("size", "500".to_string()),
                                ("page", (offset / 500).to_string()),
                                ("sort", "numberSort,asc".into()),
                            ]),
                    )
                    .await?;
                let raw = v["content"]
                    .as_array()
                    .ok_or("Invalid Komga chapter response")?;
                offset += raw.len();
                (
                    raw.iter().map(parse_komga_chapter).collect(),
                    v["totalElements"].as_u64().unwrap_or(0) as usize,
                )
            };
            chapters.extend(rows);
            if offset >= total || offset >= 10000 || offset == previous_offset {
                break;
            }
        }
        for c in &mut chapters {
            if let Some(old) = b
                .chapters
                .iter()
                .find(|old| old.id == c.id && old.downloaded)
            {
                c.downloaded = true;
                c.path = old.path.clone()
            }
        }
        Ok(chapters)
    }
    pub async fn manifest(&self, b: &Book, c: &Chapter, cfg: &Settings) -> Result<Manifest> {
        if let Some(id) = b.source.strip_prefix("ext:") {
            return self.extensions.get(id)?.manifest(self, b, c).await;
        }
        valid_id(&c.id)?;
        let urls = if b.source == "mangadex" {
            let v = self.md(&format!("/at-home/server/{}", c.id), &[]).await?;
            let base = v["baseUrl"]
                .as_str()
                .ok_or("Source did not provide a page server")?;
            let url = reqwest::Url::parse(base).map_err(|_| "Invalid page server")?;
            if url.scheme() != "https" {
                return Err("Source returned an insecure page server".into());
            }
            let mode = if cfg.data_saver { "data-saver" } else { "data" };
            let key = if cfg.data_saver { "dataSaver" } else { "data" };
            let hash = v["chapter"]["hash"]
                .as_str()
                .ok_or("Missing chapter hash")?;
            valid_id(hash)?;
            v["chapter"][key]
                .as_array()
                .ok_or("Source returned no chapter pages")?
                .iter()
                .filter_map(Value::as_str)
                .map(|name| format!("{base}/{mode}/{hash}/{name}"))
                .collect::<Vec<_>>()
        } else {
            let v = self
                .json(self.komga(cfg, &format!("/books/{}/pages", c.id))?)
                .await?;
            let count = v.as_array().ok_or("Invalid Komga page list")?.len();
            (1..=count)
                .map(|n| {
                    format!(
                        "{}/api/v1/books/{}/pages/{}",
                        cfg.komga_url.trim_end_matches('/'),
                        c.id,
                        n
                    )
                })
                .collect()
        };
        if urls.is_empty() {
            return Err("No readable pages are available for this chapter".into());
        }
        Ok(Manifest {
            urls,
            created: Instant::now(),
        })
    }
    pub async fn page(&self, url: &str, source: &str, cfg: &Settings) -> Result<Vec<u8>> {
        let response = if let Some(id) = source.strip_prefix("ext:") {
            self.extension_response(&self.extensions.get(id)?, url)
                .await?
        } else {
            let mut request = self.client.get(url);
            if source == "komga" {
                request = request.basic_auth(&cfg.komga_user, Some(&cfg.komga_password))
            }
            request
                .send()
                .await
                .map_err(|e| format!("Page download failed: {e}"))?
        };
        if !response.status().is_success() {
            return Err(format!(
                "Page server returned HTTP {}. Retry the chapter to renew its page links.",
                response.status()
            ));
        }
        if response.content_length().unwrap_or(0) > crate::local::MAX_PAGE {
            return Err("Remote page exceeds 64 MiB".into());
        }
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if bytes.len() + chunk.len() > crate::local::MAX_PAGE as usize {
                return Err("Remote page exceeds 64 MiB".into());
            }
            bytes.extend_from_slice(&chunk)
        }
        if bytes.is_empty() {
            return Err("Source returned an empty page".into());
        }
        Ok(bytes)
    }
}
pub fn parse_md_book(v: &Value) -> Book {
    let a = &v["attributes"];
    let id = text(&v["id"]);
    let rel = v["relationships"].as_array().cloned().unwrap_or_default();
    let cover = rel
        .iter()
        .find(|r| r["type"] == "cover_art")
        .and_then(|r| r["attributes"]["fileName"].as_str())
        .map(|f| format!("https://uploads.mangadex.org/covers/{id}/{f}.256.jpg"))
        .unwrap_or_default();
    let author = rel
        .iter()
        .filter(|r| r["type"] == "author")
        .filter_map(|r| r["attributes"]["name"].as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Book {
        id: format!("mangadex:{id}"),
        title: localized(&a["title"]),
        author,
        description: localized(&a["description"]),
        cover,
        source: "mangadex".into(),
        remote_id: id,
        path: String::new(),
        status: text(&a["status"]),
        tags: a["tags"]
            .as_array()
            .map(|t| {
                t.iter()
                    .map(|v| localized(&v["attributes"]["name"]))
                    .collect()
            })
            .unwrap_or_default(),
        chapters: Vec::new(),
        favorite: false,
    }
}
fn parse_md_chapter(v: &Value) -> Chapter {
    let a = &v["attributes"];
    let group = v["relationships"]
        .as_array()
        .and_then(|r| r.iter().find(|r| r["type"] == "scanlation_group"))
        .map(|r| text(&r["attributes"]["name"]))
        .unwrap_or_default();
    Chapter {
        id: text(&v["id"]),
        title: text(&a["title"]),
        number: text(&a["chapter"]),
        pages: a["pages"].as_u64().unwrap_or(0) as usize,
        path: String::new(),
        downloaded: false,
        group,
    }
}
fn parse_komga_book(v: &Value) -> Book {
    let id = text(&v["id"]);
    Book {
        id: format!("komga:{id}"),
        title: text(&v["metadata"]["title"]),
        author: "Komga library".into(),
        description: text(&v["metadata"]["summary"]),
        cover: String::new(),
        source: "komga".into(),
        remote_id: id,
        path: String::new(),
        status: text(&v["metadata"]["status"]),
        tags: Vec::new(),
        chapters: Vec::new(),
        favorite: false,
    }
}
fn parse_komga_chapter(v: &Value) -> Chapter {
    Chapter {
        id: text(&v["id"]),
        title: text(&v["metadata"]["title"]),
        number: v["metadata"]["number"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v["number"].to_string()),
        pages: v["media"]["pagesCount"].as_u64().unwrap_or(0) as usize,
        path: String::new(),
        downloaded: false,
        group: "Komga".into(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_localized_metadata() {
        let b = parse_md_book(
            &serde_json::json!({"id":"abc","attributes":{"title":{"ja":"日本語"},"status":"ongoing","description":{"en":"A story"}},"relationships":[{"type":"cover_art","attributes":{"fileName":"x.jpg"}},{"type":"author","attributes":{"name":"Author"}}]}),
        );
        assert_eq!(b.title, "日本語");
        assert_eq!(b.author, "Author");
        assert!(b.cover.ends_with("x.jpg.256.jpg"));
    }
    #[test]
    fn source_ids_reject_traversal() {
        assert!(valid_id("../bad").is_err());
        assert!(valid_id("abc-123").is_ok());
    }
    #[test]
    fn komga_adapter_search_chapters_manifest_and_page() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..4 {
                let (mut socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(10)))
                    .unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = socket.read(&mut chunk).unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..n]);
                }
                let request = String::from_utf8(request).unwrap();
                assert!(request
                    .to_lowercase()
                    .contains("authorization: basic dxnlcjpwyxnz"));
                let path = request.split_whitespace().nth(1).unwrap();
                let body = if path.starts_with("/api/v1/series?") {
                    r#"{"content":[{"id":"s1","metadata":{"title":"Test series","status":"ONGOING"}}],"totalElements":1}"#
                } else if path.starts_with("/api/v1/series/s1/books?") {
                    r#"{"content":[{"id":"b1","metadata":{"title":"Volume 1","number":"1"},"media":{"pagesCount":2}}],"totalElements":1}"#
                } else if path == "/api/v1/books/b1/pages" {
                    r#"[{"number":1},{"number":2}]"#
                } else if path == "/api/v1/books/b1/pages/1" {
                    "test-image-bytes"
                } else {
                    panic!("Unexpected Komga endpoint: {path}")
                };
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let source = Sources::new().unwrap();
            let mut cfg = Settings::default();
            cfg.komga_url = format!("http://{address}");
            cfg.komga_user = "user".into();
            cfg.komga_password = "pass".into();
            let catalog = source.search("komga", "test", 0, &cfg).await.unwrap();
            assert_eq!(catalog.books[0].title, "Test series");
            let chapters = source.chapters(&catalog.books[0], &cfg).await.unwrap();
            assert_eq!(chapters[0].pages, 2);
            let manifest = source
                .manifest(&catalog.books[0], &chapters[0], &cfg)
                .await
                .unwrap();
            assert_eq!(manifest.urls.len(), 2);
            let page = source.page(&manifest.urls[0], "komga", &cfg).await.unwrap();
            assert_eq!(page, b"test-image-bytes");
        });
        server.join().unwrap();
    }
}
