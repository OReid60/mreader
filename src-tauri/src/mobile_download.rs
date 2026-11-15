//! Short-lived, explicit LAN sharing of the bundled, signed Android installer.
#[cfg(not(target_os = "android"))]
mod desktop {
    use qrcodegen::{QrCode, QrCodeEcc};
    use serde::Serialize;
    use std::{
        io::{Read, Write},
        net::{IpAddr, TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
        time::{Duration, Instant},
    };
    const APK: &[u8] = include_bytes!("../../resources/mobile/Mreader-android.apk");
    pub const VERSION: &str = "0.3.9";
    const TTL: Duration = Duration::from_secs(600);
    type Result<T> = std::result::Result<T, String>;
    struct Active {
        stop: Arc<AtomicBool>,
        code: Code,
        port: u16,
        path: String,
        deadline: Instant,
    }
    #[derive(Default)]
    pub struct Service {
        active: Mutex<Option<Active>>,
    }
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Code {
        pub url: String,
        pub svg: String,
        pub addresses: Vec<String>,
        pub address: String,
        pub expires_at: i64,
        pub version: &'static str,
        pub bytes: usize,
    }
    fn private(ip: IpAddr) -> bool {
        matches!(ip,IpAddr::V4(ip) if ip.is_private() || ip.is_loopback())
    }
    fn qr(text: &str) -> Result<String> {
        let code = QrCode::encode_text(text, QrCodeEcc::Medium).map_err(|e| e.to_string())?;
        let mut path = String::new();
        for y in 0..code.size() {
            for x in 0..code.size() {
                if code.get_module(x, y) {
                    path.push_str(&format!("M{},{}h1v1h-1z", x + 4, y + 4));
                }
            }
        }
        let size = code.size() + 8;
        Ok(format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" role=\"img\" aria-label=\"Android APK download QR code\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><path d=\"{path}\" fill=\"black\"/></svg>"))
    }
    fn response(
        stream: &mut TcpStream,
        status: &str,
        body: &[u8],
        head: bool,
        apk: bool,
    ) -> std::io::Result<()> {
        let kind = if apk {
            "application/vnd.android.package-archive"
        } else {
            "text/plain; charset=utf-8"
        };
        write!(stream,"HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: {kind}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",body.len())?;
        if apk {
            write!(
                stream,
                "Content-Disposition: attachment; filename=\"Mreader-{VERSION}-arm64.apk\"\r\n"
            )?;
        }
        stream.write_all(b"\r\n")?;
        if !head {
            stream.write_all(body)?;
        }
        stream.flush()
    }
    fn serve(mut stream: TcpStream, path: &str, body: &[u8]) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));
        let start = Instant::now();
        let mut headers = Vec::new();
        let mut chunk = [0; 1024];
        while headers.len() < 8192 && start.elapsed() < Duration::from_secs(2) {
            match stream.read(&mut chunk) {
                Ok(0) | Err(_) => return,
                Ok(n) => headers.extend_from_slice(&chunk[..n]),
            }
            if headers.windows(4).any(|s| s == b"\r\n\r\n") {
                break;
            }
        }
        if !headers.windows(4).any(|s| s == b"\r\n\r\n") {
            return;
        }
        let line = headers.split(|b| *b == b'\n').next().unwrap_or_default();
        let parts = std::str::from_utf8(line)
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>();
        if parts.len() != 3 || !matches!(parts[2], "HTTP/1.0" | "HTTP/1.1") {
            let _ = response(&mut stream, "400 Bad Request", b"Bad request", false, false);
            return;
        }
        let head = parts[0] == "HEAD";
        if !matches!(parts[0], "GET" | "HEAD") {
            let _ = response(
                &mut stream,
                "405 Method Not Allowed",
                b"Only GET and HEAD are supported",
                false,
                false,
            );
            return;
        }
        let landing = path.strip_suffix("Mreader-android.apk").unwrap_or(path);
        if parts[1] == landing || parts[1] == landing.trim_end_matches('/') {
            let page = format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Download Mreader for Android</title><style>body{{margin:0;background:#15151a;color:#f0eef7;font:17px system-ui,sans-serif;padding:32px 20px}}main{{max-width:480px;margin:8vh auto}}h1{{font-size:30px}}p{{line-height:1.6;color:#bcb7ca}}a{{display:block;text-align:center;padding:18px;border-radius:12px;background:#c3b1ef;color:#211735;font-weight:700;text-decoration:none;margin:28px 0}}small{{color:#aaa}}</style><main><h1>Mreader for Android</h1><p>Read on your phone or tablet and sync with your desktop account.</p><a href=\"{path}\" download=\"Mreader-{VERSION}-arm64.apk\">Download APK · {:.1} MB</a><small>Version {VERSION} · ARM64 · Android 8 or later</small><p>This signed installer comes directly from your computer. Install it over an existing Mreader app to keep your data.</p><p>Keep desktop Mreader open until the download finishes. If the link expires, scan a fresh code in Settings → Mobile app.</p></main></html>", body.len() as f64 / 1_000_000.0);
            let _ = write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\nConnection: close\r\n\r\n",page.len());
            if !head {
                let _ = stream.write_all(page.as_bytes());
            }
            let _ = stream.flush();
            return;
        }
        if parts[1] != path {
            let _ = response(
                &mut stream,
                "404 Not Found",
                b"Download link is unavailable",
                head,
                false,
            );
            return;
        }
        let _ = response(&mut stream, "200 OK", body, head, true);
    }
    fn run(listener: TcpListener, path: String, stop: Arc<AtomicBool>, ttl: Duration) {
        let until = Instant::now() + ttl;
        while !stop.load(Ordering::Relaxed) && Instant::now() < until {
            match listener.accept() {
                Ok((stream, peer)) if private(peer.ip()) => serve(stream, &path, APK),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100))
                }
                Err(_) => break,
            }
        }
    }
    impl Service {
        pub fn stop(&self) -> Result<()> {
            if let Some(active) = self.active.lock().map_err(|e| e.to_string())?.take() {
                active.stop.store(true, Ordering::Relaxed);
            }
            Ok(())
        }
        pub fn start(&self, requested: Option<String>) -> Result<Code> {
            let mut active = self.active.lock().map_err(|e| e.to_string())?;
            if let Some(existing) = active.as_mut() {
                if !existing.stop.load(Ordering::Relaxed) && Instant::now() < existing.deadline {
                    let mut code = existing.code.clone();
                    if let Some(address) =
                        requested.as_ref().filter(|ip| code.addresses.contains(ip))
                    {
                        code.address = address.clone();
                    }
                    let landing = existing
                        .path
                        .strip_suffix("Mreader-android.apk")
                        .unwrap_or(&existing.path);
                    code.url = format!("http://{}:{}{}", code.address, existing.port, landing);
                    code.svg = qr(&code.url)?;
                    existing.code = code.clone();
                    return Ok(code);
                }
            }
            let mut addresses = if_addrs::get_if_addrs()
                .map_err(|e| e.to_string())?
                .into_iter()
                .filter_map(|i| match i.ip() {
                    IpAddr::V4(ip) if ip.is_private() && !ip.is_loopback() => Some(ip.to_string()),
                    _ => None,
                })
                .collect::<Vec<_>>();
            addresses.sort_by_key(|ip| {
                (
                    if ip.starts_with("192.168.") {
                        0
                    } else if ip.starts_with("172.") {
                        1
                    } else {
                        2
                    },
                    ip.clone(),
                )
            });
            addresses.dedup();
            let address = requested
                .filter(|ip| addresses.contains(ip))
                .or_else(|| addresses.first().cloned())
                .ok_or(
                    "Connect this computer and phone to the same Wi-Fi or local network first",
                )?;
            let listener = TcpListener::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let path = format!("/{}/Mreader-android.apk", uuid::Uuid::new_v4());
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let url = format!(
                "http://{}:{}/{}/",
                address,
                port,
                path.trim_start_matches('/')
                    .trim_end_matches("/Mreader-android.apk")
            );
            let svg = qr(&url)?;
            let stop = Arc::new(AtomicBool::new(false));
            let worker_stop = stop.clone();
            if let Some(previous) = active.take() {
                previous.stop.store(true, Ordering::Relaxed);
            }
            let worker_path = path.clone();
            std::thread::Builder::new()
                .name("mobile-installer".into())
                .spawn(move || run(listener, worker_path, worker_stop, TTL))
                .map_err(|e| e.to_string())?;
            let code = Code {
                url,
                svg,
                addresses,
                address,
                expires_at: crate::model::now_ms() + TTL.as_millis() as i64,
                version: VERSION,
                bytes: APK.len(),
            };
            *active = Some(Active {
                stop,
                code: code.clone(),
                port,
                path,
                deadline: Instant::now() + TTL,
            });
            Ok(code)
        }
    }
    impl Drop for Service {
        fn drop(&mut self) {
            let _ = self.stop();
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn bundled_installer_and_scannable_qr_fixture() {
            use sha2::{Digest, Sha256};
            assert_eq!(
                format!("{:x}", Sha256::digest(APK)),
                "d65d8cefb0a37169bf6a43ce768bfc80b1093ef755724ebc3770680cc9cc069b"
            );
            if let Ok(directory) = std::env::var("MREADER_QR_TEST_DIR") {
                std::fs::write(
                    std::path::Path::new(&directory).join("mobile-qr.svg"),
                    qr("http://192.168.1.2:1234/test-token/Mreader-android.apk").unwrap(),
                )
                .unwrap();
            }
        }
        fn request(path: &str, method: &str) -> Vec<u8> {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                serve(stream, "/token/Mreader-android.apk", b"signed-apk-fixture");
            });
            let mut client = TcpStream::connect(address).unwrap();
            write!(
                client,
                "{method} {path} HTTP/1.1\r\nHost: localhost\r\n\r\n"
            )
            .unwrap();
            let mut bytes = Vec::new();
            client.read_to_end(&mut bytes).unwrap();
            server.join().unwrap();
            bytes
        }
        #[test]
        fn download_is_exact_and_token_scoped() {
            let bytes = request("/token/Mreader-android.apk", "GET");
            assert!(bytes.starts_with(b"HTTP/1.1 200"));
            assert!(bytes.ends_with(b"signed-apk-fixture"));
            assert!(request("/wrong/Mreader-android.apk", "GET").starts_with(b"HTTP/1.1 404"));
            assert!(request("/token/Mreader-android.apk", "POST").starts_with(b"HTTP/1.1 405"));
            assert!(!request("/token/Mreader-android.apk", "HEAD").ends_with(b"signed-apk-fixture"));
        }
        #[test]
        fn landing_page_offers_the_bundled_apk() {
            let response = request("/token/", "GET");
            let text = String::from_utf8(response).unwrap();
            assert!(text.starts_with("HTTP/1.1 200 OK"));
            assert!(text.contains("Content-Type: text/html; charset=utf-8"));
            assert!(text.contains("href=\"/token/Mreader-android.apk\""));
            assert!(text.contains("Download APK"));
        }
        #[test]
        fn refreshing_keeps_existing_phone_links_alive() {
            let service = Service::default();
            let stop = Arc::new(AtomicBool::new(false));
            let code = Code {
                url: "http://127.0.0.1:1234/token/".into(),
                svg: String::new(),
                addresses: vec!["127.0.0.1".into(), "192.168.1.2".into()],
                address: "127.0.0.1".into(),
                expires_at: crate::model::now_ms() + 600000,
                version: VERSION,
                bytes: APK.len(),
            };
            *service.active.lock().unwrap() = Some(Active {
                stop: stop.clone(),
                code: code.clone(),
                port: 1234,
                path: "/token/Mreader-android.apk".into(),
                deadline: Instant::now() + TTL,
            });
            assert_eq!(service.start(None).unwrap().url, code.url);
            assert_eq!(
                service.start(Some("192.168.1.2".into())).unwrap().url,
                "http://192.168.1.2:1234/token/"
            );
            assert!(!stop.load(Ordering::Relaxed));
            assert_eq!(
                service.start(None).unwrap().url,
                "http://192.168.1.2:1234/token/"
            );
        }
        #[test]
        fn sharing_expires_without_ui() {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let worker = std::thread::spawn(move || {
                run(
                    listener,
                    "/token".into(),
                    Arc::new(AtomicBool::new(false)),
                    Duration::from_millis(50),
                )
            });
            worker.join().unwrap();
            assert!(TcpStream::connect(address).is_err());
            assert!(qr("http://192.168.1.2:1234/token/app.apk")
                .unwrap()
                .contains("viewBox"));
        }
    }
}
#[cfg(not(target_os = "android"))]
pub use desktop::*;
#[cfg(target_os = "android")]
#[derive(Default)]
pub struct Service;
