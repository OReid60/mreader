//! Lazy, loopback-only Suwayomi adapter. The JVM never owns Mreader progress.
use super::{https_url, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
const VERSION: &str = "v2.4.2366";
const WINDOWS_SHA: &str = "b955f374a8d94b8d1c2750ae28fa7eb2066b479957561b5ba9cf8ac993c8fc13";
const JAR_SHA: &str = "af9feb20af9d7ebe9e30769e6c6ebc7fc7ab1c447388d42e0280b1da5fe07bfd";
#[derive(Clone)]
struct Connection {
    url: String,
    password: String,
}
struct Server {
    child: Child,
    connection: Connection,
}
#[derive(Default)]
pub struct Desktop {
    dir: Mutex<Option<PathBuf>>,
    server: Mutex<Option<Server>>,
    gate: tokio::sync::Mutex<()>,
}
impl Drop for Desktop {
    fn drop(&mut self) {
        if let Ok(server) = self.server.get_mut() {
            if let Some(server) = server.as_mut() {
                let _ = server.child.kill();
                let _ = server.child.wait();
            }
        }
    }
}
impl Desktop {
    pub fn stop(&self) {
        if let Ok(mut server) = self.server.lock() {
            if let Some(mut server) = server.take() {
                let _ = server.child.kill();
                let _ = server.child.wait();
            }
        }
    }
    pub fn set_dir(&self, dir: &Path) -> Result<()> {
        *self.dir.lock().map_err(|e| e.to_string())? = Some(dir.join("runtime"));
        Ok(())
    }
    async fn start(&self) -> Result<Connection> {
        let _guard = self.gate.lock().await;
        if let Some(server) = self.server.lock().map_err(|e| e.to_string())?.as_mut() {
            if server
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Ok(server.connection.clone());
            }
        }
        let dir = self
            .dir
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("Runtime directory missing")?;
        let (java, jar) = prepare(&dir).await?;
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| e.to_string())?
            .local_addr()
            .map_err(|e| e.to_string())?
            .port();
        let connection = Connection {
            url: format!("http://127.0.0.1:{port}"),
            password: uuid::Uuid::new_v4().to_string(),
        };
        let state = dir.join("state");
        std::fs::create_dir_all(&state).map_err(|e| e.to_string())?;
        let log = std::fs::File::create(dir.join("runtime.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(java);
        command.args([
            "-Xms32m",
            "-Xmx384m",
            "-XX:ActiveProcessorCount=2",
            "-Djava.awt.headless=true",
            "--enable-native-access=ALL-UNNAMED",
        ]);
        for (key, value) in [
            ("rootDir", state.to_string_lossy().into_owned()),
            ("ip", "127.0.0.1".into()),
            ("port", port.to_string()),
            ("initialOpenInBrowserEnabled", "false".into()),
            ("systemTrayEnabled", "false".into()),
            ("webUIEnabled", "false".into()),
            ("webUIUpdateCheckInterval", "0".into()),
            ("kcefEnabled", "false".into()),
            ("flareSolverrEnabled", "false".into()),
            ("globalUpdateInterval", "0".into()),
            ("authMode", "BASIC_AUTH".into()),
            ("authUsername", "mreader".into()),
            ("authPassword", connection.password.clone()),
        ] {
            command.arg(format!("-Dsuwayomi.tachidesk.config.server.{key}={value}"));
        }
        command
            .arg("-jar")
            .arg(jar)
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000 | 0x00004000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start APK runtime: {e}"))?;
        for _ in 0..120 {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                return Err(format!(
                    "APK runtime stopped; see {}",
                    dir.join("runtime.log").display()
                ));
            }
            if gql(&connection, "{__typename}", json!({})).await.is_ok() {
                *self.server.lock().map_err(|e| e.to_string())? = Some(Server {
                    child,
                    connection: connection.clone(),
                });
                return Ok(connection);
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        let _ = child.kill();
        Err("APK runtime startup timed out".into())
    }
    pub async fn call(&self, args: Value) -> Result<Value> {
        let c = self.start().await?;
        match args["operation"].as_str().unwrap_or("") {
            "load" => Ok(json!({})),
            "install" => {
                let repo=args["repository"].as_str().ok_or("Missing repository")?;
                // Suwayomi validates the APK against the catalog signing fingerprint.
                let store=gql(&c,"mutation($i:AddExtensionStoreInput!){addExtensionStore(input:$i){extensionStore{indexUrl signingKey}}}",json!({"i":{"indexUrl":repo}})).await?;
                if store["addExtensionStore"]["extensionStore"]["signingKey"]!=args["signingKey"]{return Err("Runtime repository signing identity does not match the trusted catalog".into());}
                gql(&c,"mutation{fetchExtensions(input:{}){extensions{pkgName}}}",json!({})).await?;
                let data=gql(&c,"mutation($i:UpdateExtensionInput!){updateExtension(input:$i){extension{pkgName isInstalled versionCode}}}",json!({"i":{"id":args["package"],"patch":{"install":true,"update":true}}})).await?;
                if data["updateExtension"]["extension"]["isInstalled"]!=true || data["updateExtension"]["extension"]["versionCode"]!=args["versionCode"]{return Err("Runtime did not install the catalog extension version".into());}
                Ok(json!({}))
            }
            "remove" => gql(&c,"mutation($i:UpdateExtensionInput!){updateExtension(input:$i){extension{pkgName isInstalled}}}",json!({"i":{"id":args["package"],"patch":{"uninstall":true}}})).await,
            "search" => search(&c,&args).await,
            "chapters" => {
                let id=manga_id(&c,&args["sourceId"],args["url"].as_str().unwrap_or(""),args["title"].as_str().unwrap_or("")).await?;
                let data=chapters(&c,id).await?;
                Ok(json!({"manga":data["manga"],"chapters":data["chapters"]}))
            }
            "pages" => {
                let id=manga_id(&c,&args["sourceId"],args["mangaUrl"].as_str().unwrap_or(""),args["mangaTitle"].as_str().unwrap_or("")).await?;
                let data=chapters(&c,id).await?;
                let chapter=data["chapters"].as_array().and_then(|rows|rows.iter().find(|r|r["url"]==args["url"])).ok_or("This chapter no longer exists at the source")?;
                let data=gql(&c,"mutation($i:FetchChapterPagesInput!){fetchChapterPages(input:$i){pages}}",json!({"i":{"chapterId":chapter["runtimeId"]}})).await?;
                let rows=data["fetchChapterPages"]["pages"].as_array().ok_or("Invalid runtime pages")?;
                Ok(Value::Array(rows.iter().map(|p|json!({"runtimePath":p})).collect()))
            }
            _ => Err("Unknown APK runtime operation".into())
        }
    }
    pub async fn image(&self, args: Value) -> Result<Vec<u8>> {
        let c = self.start().await?;
        let path = if let Some(path) = args["page"]["runtimePath"].as_str() {
            path.to_string()
        } else if let Some(url) = args["page"]["mangaUrl"].as_str() {
            let id = manga_id(
                &c,
                &args["sourceId"],
                url,
                args["page"]["mangaTitle"].as_str().unwrap_or(""),
            )
            .await?;
            format!("/api/v1/manga/{id}/thumbnail")
        } else {
            let data = gql(
                &c,
                "query($c:MangaConditionInput!){mangas(condition:$c,first:1){nodes{id}}}",
                json!({"c":{"sourceId":args["sourceId"],"thumbnailUrl":args["page"]["imageUrl"]}}),
            )
            .await?;
            let id = data["mangas"]["nodes"][0]["id"]
                .as_i64()
                .ok_or("Refresh this title to load its extension cover on this device")?;
            format!("/api/v1/manga/{id}/thumbnail")
        };
        if !path.starts_with("/api/") || path.contains("://") || path.contains("..") {
            return Err("Invalid local runtime image path".into());
        }
        let response = client()?
            .get(format!("{}{path}", c.url))
            .basic_auth("mreader", Some(c.password))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            if bytes.len() + chunk.len() > 64 * 1024 * 1024 {
                return Err("Extension image exceeds 64 MiB".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}
fn client() -> Result<&'static reqwest::Client> {
    static CLIENT: std::sync::OnceLock<std::result::Result<reqwest::Client, String>> =
        std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(std::time::Duration::from_secs(90))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}
async fn gql(c: &Connection, query: &str, variables: Value) -> Result<Value> {
    let data: Value = client()?
        .post(format!("{}/api/graphql", c.url))
        .basic_auth("mreader", Some(&c.password))
        .json(&json!({"query":query,"variables":variables}))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if let Some(errors) = data["errors"].as_array() {
        if !errors.is_empty() {
            return Err(errors
                .iter()
                .map(|e| e["message"].as_str().unwrap_or("Extension runtime error"))
                .collect::<Vec<_>>()
                .join("; "));
        }
    }
    data.get("data")
        .cloned()
        .ok_or("Invalid runtime response".into())
}
async fn search(c: &Connection, args: &Value) -> Result<Value> {
    let query = args["query"].as_str().unwrap_or("");
    let data=gql(c,"mutation($i:FetchSourceMangaInput!){fetchSourceManga(input:$i){hasNextPage mangas{id url title author description thumbnailUrl genre}}}",json!({"i":{"source":args["sourceId"],"query":query,"page":args["page"],"type":if query.is_empty(){"POPULAR"}else{"SEARCH"}}})).await?;
    let result = &data["fetchSourceManga"];
    let rows = result["mangas"]
        .as_array()
        .ok_or("Invalid extension search response")?;
    Ok(
        json!({"hasNextPage":result["hasNextPage"],"mangas":rows.iter().map(|m|json!({"url":m["url"],"title":m["title"],"author":m["author"],"description":m["description"],"cover":m["thumbnailUrl"],"genre":m["genre"].as_array().map(|g|g.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")).unwrap_or_default()})).collect::<Vec<_>>()}),
    )
}
async fn manga_id(c: &Connection, source: &Value, url: &str, title: &str) -> Result<i64> {
    let query = "query($c:MangaConditionInput!){mangas(condition:$c,first:1){nodes{id}}}";
    let vars = json!({"c":{"sourceId":source,"url":url}});
    let data = gql(c, query, vars.clone()).await?;
    if let Some(id) = data["mangas"]["nodes"][0]["id"].as_i64() {
        return Ok(id);
    }
    // Backend row IDs differ on each device. Recover them using the portable source URL.
    search(c, &json!({"sourceId":source,"query":title,"page":1})).await?;
    let data = gql(c, query, vars).await?;
    data["mangas"]["nodes"][0]["id"].as_i64().ok_or(
        "Synced title was not found by this extension. Search for it again on this device.".into(),
    )
}
async fn chapters(c: &Connection, id: i64) -> Result<Value> {
    let data=gql(c,"mutation($i:FetchMangaAndChaptersInput!){fetchMangaAndChapters(input:$i){manga{url title} chapters{id url name chapterNumber scanlator}}}",json!({"i":{"id":id,"fetchManga":true,"fetchChapters":true}})).await?;
    let result = &data["fetchMangaAndChapters"];
    let rows = result["chapters"]
        .as_array()
        .ok_or("Invalid extension chapters response")?;
    Ok(
        json!({"manga":result["manga"],"chapters":rows.iter().map(|c|json!({"runtimeId":c["id"],"url":c["url"],"title":c["name"],"number":c["chapterNumber"].to_string(),"group":c["scanlator"]})).collect::<Vec<_>>()}),
    )
}
async fn prepare(dir: &Path) -> Result<(PathBuf, PathBuf)> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let home = std::env::var_os("MREADER_COMPAT_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dir.join(VERSION));
    let jar = home.join("suwayomi.jar");
    let java = home.join(if cfg!(target_os = "windows") {
        "jre/bin/java.exe"
    } else {
        "jre/bin/java"
    });
    if jar.exists()
        && java.exists()
        && (home.join(".ready").exists() || std::env::var_os("MREADER_COMPAT_HOME").is_some())
    {
        return Ok((java, jar));
    }
    #[cfg(target_os = "linux")]
    {
        if !cfg!(target_arch = "x86_64") {
            return Err("Automatic APK runtime setup currently supports Linux x86_64".into());
        }
        let archive = dir.join("runtime-download.tar.gz");
        let url=format!("https://github.com/Suwayomi/Suwayomi-Server/releases/download/{VERSION}/Suwayomi-Server-{VERSION}-linux-x64.tar.gz");
        download_runtime(
            &url,
            &archive,
            "7a469f8c820e65305f795d61f1776c783919884531497b587bdff898a7e0fa73",
        )
        .await?;
        let output = home.clone();
        let archive_file = archive.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<()> {
            // This exact archive is pinned by SHA-256 and its JRE contains no links.
            // Select only the JRE and server; do not unpack Electron or launchers.
            std::fs::create_dir_all(&output).map_err(|e| e.to_string())?;
            let root = format!("Suwayomi-Server-{VERSION}-linux-x64");
            let status = Command::new("tar")
                .arg("-xzf")
                .arg(&archive_file)
                .arg("-C")
                .arg(&output)
                .arg("--strip-components=1")
                .arg(format!("{root}/jre"))
                .arg(format!("{root}/bin/Suwayomi-Server.jar"))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .status()
                .map_err(|e| format!("Runtime extraction requires tar: {e}"))?;
            if !status.success() {
                return Err("Cannot extract the verified Linux runtime".into());
            }
            std::fs::rename(
                output.join("bin/Suwayomi-Server.jar"),
                output.join("suwayomi.jar"),
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
        let _ = std::fs::remove_file(archive);
        if !java.exists() || !jar.exists() {
            return Err("Runtime archive is missing Java or the extension engine".into());
        }
        std::fs::write(home.join(".ready"), VERSION).map_err(|e| e.to_string())?;
        Ok((java, jar))
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        return Err("APK desktop runtime supports Windows and Linux".into());
    }
    #[cfg(target_os = "windows")]
    {
        let url=format!("https://github.com/Suwayomi/Suwayomi-Server/releases/download/{VERSION}/Suwayomi-Server-{VERSION}-windows-x64.zip");
        https_url(&url)?;
        let response = reqwest::Client::new()
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let zip_path = dir.join("runtime-download.zip");
        let mut file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut hash = Sha256::new();
        let mut size = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| e.to_string())?;
            size += chunk.len();
            if size > 512 * 1024 * 1024 {
                return Err("Runtime download exceeds size limit".into());
            }
            hash.update(&chunk);
            file.write_all(&chunk).map_err(|e| e.to_string())?;
        }
        drop(file);
        if format!("{:x}", hash.finalize()) != WINDOWS_SHA {
            return Err("Runtime checksum mismatch".into());
        }
        let output = home.clone();
        let archive = zip_path.clone();
        tauri::async_runtime::spawn_blocking(move || -> Result<()> {
            let mut zip =
                zip::ZipArchive::new(std::fs::File::open(archive).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            for i in 0..zip.len() {
                let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
                let name = entry
                    .enclosed_name()
                    .ok_or("Invalid runtime archive path")?;
                let relative: PathBuf = name.components().skip(1).collect();
                let target = if relative == Path::new("bin/Suwayomi-Server.jar") {
                    output.join("suwayomi.jar")
                } else if relative.starts_with("jre") {
                    output.join(relative)
                } else {
                    continue;
                };
                if entry.is_dir() {
                    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut dest = std::fs::File::create(target).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut dest).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;
        let _ = std::fs::remove_file(zip_path);
        let bytes = std::fs::read(&jar).map_err(|e| e.to_string())?;
        if format!("{:x}", Sha256::digest(bytes)) != JAR_SHA {
            return Err("Runtime JAR checksum mismatch".into());
        }
        std::fs::write(home.join(".ready"), VERSION).map_err(|e| e.to_string())?;
        Ok((java, jar))
    }
}
#[cfg(target_os = "linux")]
async fn download_runtime(url: &str, path: &Path, expected: &str) -> Result<()> {
    https_url(url)?;
    let response = reqwest::Client::builder()
        .https_only(true)
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut size = 0;
    let mut hash = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        size += chunk.len();
        if size > 512 * 1024 * 1024 {
            return Err("Runtime download exceeds size limit".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    if format!("{:x}", hash.finalize()) != expected {
        return Err("Runtime checksum mismatch".into());
    }
    Ok(())
}
