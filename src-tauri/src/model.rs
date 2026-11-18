use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cover: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_cover: Option<crate::custom_cover::Cover>,
    pub source: String,
    #[serde(default)]
    pub remote_id: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub chapters: Vec<Chapter>,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub number: String,
    #[serde(default)]
    pub pages: usize,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub downloaded: bool,
    #[serde(default)]
    pub group: String,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub source_memo: Option<serde_json::Map<String,serde_json::Value>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub book_id: String,
    pub chapter_id: String,
    pub page: usize,
    pub completed: bool,
    pub updated: i64,
}
/// Remote/source lists may omit a chapter that is still saved on this device.
pub fn preserve_device_chapters(incoming:&mut Vec<Chapter>,existing:&[Chapter]){
 for old in existing{
  if let Some(chapter)=incoming.iter_mut().find(|c|c.id==old.id){
   if chapter.source_memo.is_none(){chapter.source_memo=old.source_memo.clone();}
   if old.downloaded{chapter.path=old.path.clone();chapter.pages=old.pages;chapter.downloaded=true;}
  }else if old.downloaded{incoming.push(old.clone());}
 }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_show_cover_search")]
    pub show_cover_search: bool,
    #[serde(default = "default_apk_layout")]
    pub files_layout: String,
    #[serde(default)]
    pub dismissed_cover_warnings: Vec<String>,
    #[serde(default)]
    pub flagged_extensions: Vec<String>,
    #[serde(default = "default_apk_layout")]
    pub apk_layout: String,
    #[serde(default = "default_start_page")]
    pub start_page: String,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    pub theme: String,
    pub language: String,
    pub direction: String,
    pub fit: String,
    #[serde(default = "default_reader_layout")]
    pub reader_layout: String,
    pub data_saver: bool,
    pub komga_url: String,
    pub komga_user: String,
    #[serde(default, skip_serializing)]
    pub komga_password: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            show_cover_search: true,
            files_layout: default_apk_layout(),
            dismissed_cover_warnings: Vec::new(),
            flagged_extensions: Vec::new(),
            apk_layout: default_apk_layout(),
            start_page: default_start_page(),
            sidebar_collapsed: false,
            theme: "dark".into(),
            language: "en".into(),
            direction: "ltr".into(),
            fit: "width".into(),
            reader_layout: default_reader_layout(),
            data_saver: false,
            komga_url: String::new(),
            komga_user: String::new(),
            komga_password: String::new(),
        }
    }
}
fn default_show_cover_search() -> bool { true }
fn default_apk_layout() -> String { "list".into() }
fn default_start_page() -> String { "Library".into() }
fn default_reader_layout() -> String {
    "paged".into()
}

#[cfg(test)]
mod reader_layout_tests {
    use super::*;
    #[test]
    fn old_settings_default_to_paged_and_new_layout_roundtrips() {
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("showCoverSearch");
        legacy.as_object_mut().unwrap().remove("apkLayout");
        legacy.as_object_mut().unwrap().remove("readerLayout");
        legacy.as_object_mut().unwrap().remove("startPage");
        legacy.as_object_mut().unwrap().remove("sidebarCollapsed");
        let old: Settings = serde_json::from_value(legacy).unwrap();
        assert!(old.show_cover_search);
        assert_eq!(old.apk_layout, "list");
        assert_eq!(old.start_page, "Library");
        assert!(!old.sidebar_collapsed);
        assert!(old.flagged_extensions.is_empty());
        assert_eq!(old.reader_layout, "paged");
        let mut settings = old;
        settings.show_cover_search=false;
        settings.flagged_extensions=vec!["apk:fixture.extension".into()];
        settings.reader_layout = "continuous".into();
        settings.apk_layout = "stacked".into();
        settings.start_page = "Downloads".into();
        settings.sidebar_collapsed = true;
        let restored: Settings = serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
        assert!(!restored.show_cover_search);
        assert_eq!(restored.reader_layout, "continuous");
        assert_eq!(restored.apk_layout, "stacked");
        assert_eq!(restored.start_page, "Downloads");
        assert!(restored.sidebar_collapsed);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub categories: Vec<String>,
    pub books: Vec<Book>,
    pub progress: Vec<Progress>,
    pub settings: Settings,
    pub data_dir: String,
}

#[derive(Serialize)]
pub struct Catalog {
    pub books: Vec<Book>,
    pub total: usize,
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
