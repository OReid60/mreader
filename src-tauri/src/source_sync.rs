//! Account source choices; executable files and website credentials stay local.
use crate::{apk, cloud::Timed, model::now_ms, store::Store};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub package: String,
    pub name: String,
    pub repository: String,
    pub signing_key: String,
    pub version_code: i64,
}
impl From<&apk::Installed> for Subscription {
    fn from(e: &apk::Installed) -> Self {
        Self {
            package: e.extension.package.clone(),
            name: e
                .extension
                .name
                .chars()
                .filter(|c| !c.is_control())
                .take(120)
                .collect(),
            repository: e.repository.clone(),
            signing_key: e.signing_key.clone(),
            version_code: e.extension.version_code,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Choice {
    Apk(Subscription),
    Preferred(String),
}
impl Choice {
    pub fn validate(&self, id: &str) -> Result<()> {
        match self {
            Self::Preferred(source) => {
                if id != "preferred"
                    || source.len() > 256
                    || source.chars().any(char::is_control)
                    || !(matches!(source.as_str(), "mangadex" | "komga")
                        || source.len() > 4
                            && (source.starts_with("apk:") || source.starts_with("ext:")))
                {
                    return Err("Invalid preferred source".into());
                }
            }
            Self::Apk(s) => {
                if id != format!("apk:{}", s.package)
                    || s.package.is_empty()
                    || s.package.len() > 200
                    || !s
                        .package
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_')
                    || s.name.len() > 512
                    || s.name.chars().any(char::is_control)
                    || s.repository.len() > 2048
                    || s.signing_key.len() != 64
                    || !s.signing_key.bytes().all(|b| b.is_ascii_hexdigit())
                    || s.version_code <= 0
                {
                    return Err("Invalid synced source subscription".into());
                }
                apk::https_url(&s.repository)?;
            }
        }
        Ok(())
    }
}
pub fn load(store: &Store) -> Result<BTreeMap<String, Timed<Choice>>> {
    store
        .source_values()?
        .into_iter()
        .map(|(id, (value, stamp))| {
            Ok((
                id,
                Timed {
                    value: serde_json::from_value(value).map_err(|e| e.to_string())?,
                    updated_at: stamp,
                },
            ))
        })
        .collect()
}
pub fn put(store: &Store, id: &str, value: Choice, stamp: i64) -> Result<()> {
    value.validate(id)?;
    store.put_source_value(
        id,
        &serde_json::to_value(value).map_err(|e| e.to_string())?,
        stamp,
    )
}
pub fn installed(store: &Store, entry: &apk::Installed) -> Result<()> {
    put(
        store,
        &format!("apk:{}", entry.extension.package),
        Choice::Apk(Subscription::from(entry)),
        now_ms(),
    )
}
pub fn preferred(choices: &BTreeMap<String, Timed<Choice>>) -> Option<String> {
    match choices.get("preferred").map(|e| &e.value) {
        Some(Choice::Preferred(id)) => Some(id.clone()),
        _ => None,
    }
}
pub fn migrate(store: &Store, state: &apk::State) -> Result<()> {
    if store.metadata("source-migration")?.contains_key("v1") {
        return Ok(());
    }
    let existing = load(store)?;
    let deleted = store.metadata("deleted")?;
    for entry in &state.installed {
        let id = format!("apk:{}", entry.extension.package);
        if !existing.contains_key(&id) && !deleted.contains_key(&format!("source:{id}")) {
            put(store, &id, Choice::Apk(Subscription::from(entry)), 0)?;
        }
    }
    if !existing.contains_key("preferred") {
        let ids: Vec<_> = state
            .installed
            .iter()
            .flat_map(|e| e.extension.sources.iter().map(|s| format!("apk:{}", s.id)))
            .collect();
        if let Some(book) = store.books()?.into_iter().find(|b| ids.contains(&b.source)) {
            put(store, "preferred", Choice::Preferred(book.source), 0)?;
        }
    }
    store.mark("source-migration", "v1")
}
pub async fn prepare(
    engine: &apk::Engine,
    choices: &BTreeMap<String, Timed<Choice>>,
    deletions: &BTreeMap<String, i64>,
) -> Vec<String> {
    let mut errors = Vec::new();
    for key in deletions.keys() {
        if let Some(package) = key.strip_prefix("source:apk:") {
            if !choices.contains_key(&format!("apk:{package}"))
                && engine
                    .state()
                    .map(|s| s.installed.iter().any(|e| e.extension.package == package))
                    .unwrap_or(false)
            {
                if let Err(error) = engine.remove(package.to_string()).await {
                    errors.push(format!("{package}: {error}"));
                }
            }
        }
    }
    for entry in choices.values() {
        if let Choice::Apk(s) = &entry.value {
            let result = async {
                let state = engine.state()?;
                if let Some(old) = state
                    .installed
                    .iter()
                    .find(|e| e.extension.package == s.package)
                {
                    if !old.signing_key.eq_ignore_ascii_case(&s.signing_key) {
                        return Err(
                            "Synced signing identity differs from the installed source".into()
                        );
                    }
                    if old.extension.version_code >= s.version_code {
                        return Ok(());
                    }
                }
                let cached = state.repositories.iter().find(|r| r.url == s.repository);
                if cached
                    .is_some_and(|r| !r.catalog.signing_key.eq_ignore_ascii_case(&s.signing_key))
                {
                    return Err(
                        "Synced repository signing identity differs from this device's trusted key"
                            .into(),
                    );
                }
                let ready = cached.is_some_and(|r| {
                    r.catalog
                        .extensions
                        .iter()
                        .any(|e| e.package == s.package && e.version_code >= s.version_code)
                });
                let state = if ready {
                    state
                } else {
                    engine
                        .repository(s.repository.clone(), Some(s.signing_key.to_lowercase()))
                        .await?
                };
                let repo = state
                    .repositories
                    .iter()
                    .find(|r| r.url == s.repository)
                    .ok_or("Synced repository is unavailable")?;
                if !repo
                    .catalog
                    .signing_key
                    .eq_ignore_ascii_case(&s.signing_key)
                {
                    return Err("Synced repository signing identity did not match".into());
                }
                let ext = repo
                    .catalog
                    .extensions
                    .iter()
                    .find(|e| e.package == s.package)
                    .ok_or("Synced source is no longer in its repository")?;
                if ext.version_code < s.version_code {
                    return Err("Repository does not yet offer the synced source version".into());
                }
                engine
                    .install(s.repository.clone(), s.package.clone())
                    .await?;
                Ok::<(), String>(())
            }
            .await;
            if let Err(error) = result {
                errors.push(format!("{}: {error}", s.name));
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud::Document;
    use std::path::Path;
    fn subscription(package: &str) -> Subscription {
        Subscription {
            package: package.into(),
            name: "Source fixture".into(),
            repository: "https://fixture.test/index.pb".into(),
            signing_key: "a".repeat(64),
            version_code: 1,
        }
    }
    fn record(s: &Subscription) -> apk::Installed {
        apk::Installed {
            repository: s.repository.clone(),
            signing_key: s.signing_key.clone(),
            extension: apk::index::Extension {
                name: s.name.clone(),
                package: s.package.clone(),
                api: "1.6".into(),
                version_code: s.version_code,
                version: "1".into(),
                apk_url: "https://fixture.test/source.apk".into(),
                icon_url: String::new(),
                sources: vec![],
                content_warning: 1,
            },
        }
    }
    #[test]
    fn devices_merge_independent_sources_preference_and_uninstall() {
        let phone = Store::open(Path::new(":memory:")).unwrap();
        let desktop = Store::open(Path::new(":memory:")).unwrap();
        put(
            &phone,
            "apk:test.phone",
            Choice::Apk(subscription("test.phone")),
            100,
        )
        .unwrap();
        put(
            &phone,
            "preferred",
            Choice::Preferred("apk:123".into()),
            200,
        )
        .unwrap();
        put(
            &desktop,
            "apk:test.desktop",
            Choice::Apk(subscription("test.desktop")),
            150,
        )
        .unwrap();
        put(
            &desktop,
            "preferred",
            Choice::Preferred("mangadex".into()),
            100,
        )
        .unwrap();
        let a = Document::from_store(&phone, vec![]).unwrap();
        let b = Document::from_store(&desktop, vec![]).unwrap();
        let merged = a.merge(&b).unwrap();
        assert_eq!(merged.source_choices.len(), 3);
        assert_eq!(
            preferred(&merged.source_choices).as_deref(),
            Some("apk:123")
        );
        assert_eq!(
            serde_json::to_value(&merged).unwrap(),
            serde_json::to_value(&b.merge(&a).unwrap()).unwrap()
        );
        merged.apply(&phone).unwrap();
        merged.apply(&desktop).unwrap();
        phone.remove_source_value("apk:test.phone").unwrap();
        let removed = Document::from_store(&phone, vec![])
            .unwrap()
            .merge(&b)
            .unwrap();
        removed.apply(&desktop).unwrap();
        assert!(!load(&desktop).unwrap().contains_key("apk:test.phone"));
        let stale = apk::State {
            repositories: vec![],
            installed: vec![record(&subscription("test.phone"))],
        };
        migrate(&desktop, &stale).unwrap();
        assert!(
            !load(&desktop).unwrap().contains_key("apk:test.phone"),
            "Migration must not resurrect an uninstalled source"
        );
        put(
            &desktop,
            "apk:test.phone",
            Choice::Apk(subscription("test.phone")),
            now_ms() + 1,
        )
        .unwrap();
        let restored = Document::from_store(&desktop, vec![])
            .unwrap()
            .merge(&removed)
            .unwrap();
        assert!(restored.source_choices.contains_key("apk:test.phone"));
        assert!(!restored.deletions.contains_key("source:apk:test.phone"));
        let legacy: Document =
            serde_json::from_value(serde_json::json!({"schemaVersion":1})).unwrap();
        assert!(legacy.source_choices.is_empty());
    }
    #[test]
    fn invalid_source_metadata_is_rejected() {
        let mut s = subscription("test.source");
        s.repository = "http://fixture.test/index.pb".into();
        assert!(Choice::Apk(s.clone()).validate("apk:test.source").is_err());
        s.repository = "https://user:secret@fixture.test/index.pb".into();
        assert!(Choice::Apk(s.clone()).validate("apk:test.source").is_err());
        s.repository = "https://fixture.test/index.pb".into();
        s.signing_key = "wrong".into();
        assert!(Choice::Apk(s).validate("apk:test.source").is_err());
        assert!(Choice::Preferred("apk:".into())
            .validate("preferred")
            .is_err());
        assert!(Choice::Preferred("manga\0dex".into())
            .validate("preferred")
            .is_err());
    }
    #[test]
    fn changed_signing_identity_never_prepares_code() {
        tauri::async_runtime::block_on(async {
            let dir =
                std::env::temp_dir().join(format!("mreader-source-sync-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let s = subscription("test.source");
            let state = apk::State {
                repositories: vec![],
                installed: vec![record(&s)],
            };
            let before = serde_json::to_vec(&state).unwrap();
            std::fs::write(dir.join("state.json"), &before).unwrap();
            let engine = apk::Engine::default();
            engine.set_dir(&dir).unwrap();
            let mut wrong = s;
            wrong.signing_key = "b".repeat(64);
            let choices = BTreeMap::from([(
                "apk:test.source".into(),
                Timed {
                    value: Choice::Apk(wrong),
                    updated_at: 1,
                },
            )]);
            let errors = prepare(&engine, &choices, &BTreeMap::new()).await;
            assert_eq!(errors.len(), 1);
            assert!(errors[0].contains("signing identity"));
            assert_eq!(std::fs::read(dir.join("state.json")).unwrap(), before);
            drop(engine);
            assert!(dir
                .canonicalize()
                .unwrap()
                .starts_with(std::env::temp_dir().canonicalize().unwrap()));
            std::fs::remove_dir_all(dir).unwrap();
        });
    }
}
