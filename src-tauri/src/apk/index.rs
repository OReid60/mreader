//! Keiyoushi/Mihon v2 catalogs (gzip + protobuf). IDs stay strings at the UI boundary.
use prost::Message;
use serde::{Deserialize, Serialize};
use std::io::Read;

#[derive(Clone, PartialEq, Message)]
struct Index {
    #[prost(string, tag = "1")]
    name: String,
    #[prost(string, tag = "3")]
    signing_key: String,
    #[prost(message, optional, tag = "101")]
    list: Option<ExtensionList>,
    #[prost(string, optional, tag = "102")]
    list_url: Option<String>,
}
#[derive(Clone, PartialEq, Message)]
struct ExtensionList {
    #[prost(message, repeated, tag = "1")]
    extensions: Vec<WireExtension>,
}
#[derive(Clone, PartialEq, Message)]
struct WireExtension {
    #[prost(string, tag = "1")]
    name: String,
    #[prost(string, tag = "2")]
    package: String,
    #[prost(message, optional, tag = "3")]
    resources: Option<Resources>,
    #[prost(string, tag = "4")]
    api: String,
    #[prost(int64, tag = "5")]
    version_code: i64,
    #[prost(string, tag = "6")]
    version: String,
    #[prost(int32, tag = "7")]
    content_warning: i32,
    #[prost(message, repeated, tag = "8")]
    sources: Vec<WireSource>,
}
#[derive(Clone, PartialEq, Message)]
struct Resources {
    #[prost(string, tag = "1")]
    apk_url: String,
    #[prost(string, tag = "2")]
    icon_url: String,
    #[prost(string, optional, tag = "501")]
    jar_url: Option<String>,
}
#[derive(Clone, PartialEq, Message)]
struct WireSource {
    #[prost(int64, tag = "1")]
    id: i64,
    #[prost(string, tag = "2")]
    name: String,
    #[prost(string, tag = "3")]
    language: String,
    #[prost(string, tag = "4")]
    home_url: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub language: String,
    pub home_url: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    pub name: String,
    pub package: String,
    pub api: String,
    pub version_code: i64,
    pub version: String,
    pub apk_url: String,
    pub icon_url: String,
    pub sources: Vec<Source>,
    pub content_warning: i32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub name: String,
    pub signing_key: String,
    pub extensions: Vec<Extension>,
}
pub fn decode(bytes: &[u8]) -> Result<Catalog, String> {
    let mut inflated = Vec::new();
    let bytes = if bytes.starts_with(&[0x1f, 0x8b]) {
        flate2::read::GzDecoder::new(bytes)
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut inflated)
            .map_err(|e| e.to_string())?;
        if inflated.len() > 8 * 1024 * 1024 {
            return Err("Extension catalog exceeds 8 MiB".into());
        }
        &inflated[..]
    } else {
        bytes
    };
    let index = Index::decode(bytes).map_err(|e| format!("Invalid extension catalog: {e}"))?;
    if index.signing_key.len() != 64 || !index.signing_key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Catalog has no valid APK signing fingerprint".into());
    }
    let list = index.list.ok_or_else(|| {
        if index.list_url.is_some() {
            "Separate extension-list catalogs are not supported yet"
        } else {
            "Catalog has no extension list"
        }
        .to_string()
    })?;
    let mut extensions = Vec::new();
    for e in list.extensions {
        if !matches!(e.api.as_str(), "1.4" | "1.6") {
            continue;
        }
        if e.package.len() > 200
            || !e
                .package
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
        {
            return Err("Invalid APK package name".into());
        }
        let r = e.resources.ok_or("Missing APK resource")?;
        crate::apk::https_url(&r.apk_url)?;
        extensions.push(Extension {
            name: e.name,
            package: e.package,
            api: e.api,
            version_code: e.version_code,
            version: e.version,
            apk_url: r.apk_url,
            icon_url: r.icon_url,
            content_warning: e.content_warning,
            sources: e
                .sources
                .into_iter()
                .map(|s| Source {
                    id: s.id.to_string(),
                    name: s.name,
                    language: s.language,
                    home_url: s.home_url,
                })
                .collect(),
        });
    }
    Ok(Catalog {
        name: index.name,
        signing_key: index.signing_key.to_lowercase(),
        extensions,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_survive_javascript_boundary() {
        let index = Index {
            name: "Test".into(),
            signing_key: "a".repeat(64),
            list_url: None,
            list: Some(ExtensionList {
                extensions: vec![WireExtension {
                    name: "Test".into(),
                    package: "test.extension".into(),
                    api: "1.6".into(),
                    version_code: 1,
                    version: "1".into(),
                    content_warning: 1,
                    resources: Some(Resources {
                        apk_url: "https://example.org/source.apk".into(),
                        icon_url: String::new(),
                        jar_url: None,
                    }),
                    sources: vec![WireSource {
                        id: 9223372036854775806,
                        name: "Test".into(),
                        language: "en".into(),
                        home_url: String::new(),
                    }],
                }],
            }),
        };
        let c = decode(&index.encode_to_vec()).unwrap();
        assert_eq!(c.extensions[0].sources[0].id, "9223372036854775806");
        assert!(serde_json::to_string(&c)
            .unwrap()
            .contains("\"9223372036854775806\""));
        assert!(decode(&[255; 20]).is_err());
    }
}
