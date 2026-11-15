//! Generate an offline QR image for the public HTTPS Android download page.
#[cfg(not(target_os = "android"))]
mod desktop {
    use qrcodegen::{QrCode, QrCodeEcc};
    use serde::Serialize;
    type Result<T> = std::result::Result<T, String>;
    pub const DOWNLOAD_URL: &str =
        "https://mreader-android-download-20261115.supernova-pp1457.chatgpt.site/";
    #[derive(Default)]
    pub struct Service;
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Code {
        pub url: &'static str,
        pub svg: String,
        pub hosted: bool,
        pub version: &'static str,
        pub bytes: usize,
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
        Ok(format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {size} {size}\" role=\"img\" aria-label=\"Android download page QR code\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><path d=\"{path}\" fill=\"black\"/></svg>"))
    }
    impl Service {
        pub fn start(&self, _address: Option<String>) -> Result<Code> {
            Ok(Code {
                url: DOWNLOAD_URL,
                svg: qr(DOWNLOAD_URL)?,
                hosted: true,
                version: "0.3.9",
                bytes: 15_779_968,
            })
        }
        pub fn stop(&self) -> Result<()> {
            Ok(())
        }
    }
    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn qr_opens_the_public_https_page() {
            let code = Service.start(None).unwrap();
            assert_eq!(code.url, DOWNLOAD_URL);
            assert!(code.url.starts_with("https://"));
            assert!(code.hosted);
            assert!(!code.svg.contains("192.168."));
            if let Ok(dir) = std::env::var("MREADER_QR_TEST_DIR") {
                std::fs::write(std::path::Path::new(&dir).join("mobile-qr.svg"), &code.svg)
                    .unwrap();
            }
        }
        #[test]
        fn destination_is_stable_and_ignores_legacy_lan_address() {
            let service = Service;
            let first = service.start(None).unwrap();
            service.stop().unwrap();
            assert_eq!(
                first.url,
                service.start(Some("192.168.100.64".into())).unwrap().url
            );
        }
    }
}
#[cfg(not(target_os = "android"))]
pub use desktop::*;
#[cfg(target_os = "android")]
#[derive(Default)]
pub struct Service;
