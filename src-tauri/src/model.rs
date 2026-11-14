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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub direction: String,
    pub fit: String,
    pub data_saver: bool,
    pub komga_url: String,
    pub komga_user: String,
    #[serde(default, skip_serializing)]
    pub komga_password: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            language: "en".into(),
            direction: "ltr".into(),
            fit: "width".into(),
            data_saver: false,
            komga_url: String::new(),
            komga_user: String::new(),
            komga_password: String::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
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
