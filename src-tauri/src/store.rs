use crate::model::*;
use rusqlite::{params, Connection};
use std::{path::Path, sync::Mutex};
pub struct Store(pub Mutex<Connection>);
type Result<T> = std::result::Result<T, String>;
impl Store {
    pub fn merge(&self, books: &[Book], progress: &[Progress], settings: &Settings) -> Result<()> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        for b in books {
            tx.execute("INSERT INTO books(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![b.id,serde_json::to_string(b).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
            tx.execute(
                "INSERT OR REPLACE INTO sync_meta VALUES('book',?1,?2)",
                params![b.id, now_ms()],
            )
            .map_err(|e| e.to_string())?;
        }
        for p in progress {
            tx.execute("INSERT INTO progress VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book,chapter) DO UPDATE SET page=excluded.page,completed=excluded.completed,updated=excluded.updated",params![p.book_id,p.chapter_id,p.page,p.completed,p.updated]).map_err(|e|e.to_string())?;
        }
        tx.execute(
            "INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            [serde_json::to_string(settings).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn open(path: &Path) -> Result<Self> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS progress(book TEXT NOT NULL,chapter TEXT NOT NULL,page INTEGER NOT NULL,completed INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(book,chapter)); CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,data TEXT NOT NULL);").map_err(|e|e.to_string())?;
        db.execute_batch("CREATE TABLE IF NOT EXISTS sync_meta(kind TEXT NOT NULL,key TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(kind,key));").map_err(|e|e.to_string())?;
        Ok(Self(Mutex::new(db)))
    }
    pub fn books(&self) -> Result<Vec<Book>> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut q = db
            .prepare("SELECT data FROM books ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn book(&self, id: &str) -> Result<Book> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let json: String = db
            .query_row("SELECT data FROM books WHERE id=?1", [id], |r| r.get(0))
            .map_err(|e| {
                if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                    "Title is no longer in your library".into()
                } else {
                    e.to_string()
                }
            })?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }
    pub fn put(&self, b: &Book) -> Result<()> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO books(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![b.id,serde_json::to_string(b).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO sync_meta VALUES('book',?1,?2)",
            params![b.id, now_ms()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM sync_meta WHERE kind='deleted' AND key=?1",
            [format!("book:{}", b.id)],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM books WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM progress WHERE book=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO sync_meta VALUES('deleted',?1,?2)",
            params![format!("book:{id}"), now_ms()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn progress(&self) -> Result<Vec<Progress>> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut q = db
            .prepare(
                "SELECT book,chapter,page,completed,updated FROM progress ORDER BY updated DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| {
                Ok(Progress {
                    book_id: r.get(0)?,
                    chapter_id: r.get(1)?,
                    page: r.get(2)?,
                    completed: r.get(3)?,
                    updated: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }
    pub fn save_progress(&self, p: &Progress) -> Result<()> {
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO progress VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book,chapter) DO UPDATE SET page=excluded.page,completed=MAX(progress.completed,excluded.completed),updated=excluded.updated",params![p.book_id,p.chapter_id,p.page,p.completed,p.updated]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn settings(&self) -> Result<Settings> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut q = db
            .prepare("SELECT data FROM settings WHERE id=1")
            .map_err(|e| e.to_string())?;
        let mut rows = q.query([]).map_err(|e| e.to_string())?;
        match rows.next().map_err(|e| e.to_string())? {
            Some(r) => serde_json::from_str(&r.get::<_, String>(0).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string()),
            None => Ok(Settings::default()),
        }
    }
    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        self.0.lock().map_err(|e|e.to_string())?.execute("INSERT INTO settings VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data",[serde_json::to_string(s).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn switch(&self, path: &Path) -> Result<()> {
        let new = Self::open(path)?;
        let connection = new.0.into_inner().map_err(|e| e.to_string())?;
        *self.0.lock().map_err(|e| e.to_string())? = connection;
        Ok(())
    }
    pub fn mark(&self, kind: &str, key: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .execute(
                "INSERT OR REPLACE INTO sync_meta VALUES(?1,?2,?3)",
                params![kind, key, now_ms()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn metadata(&self, kind: &str) -> Result<std::collections::BTreeMap<String, i64>> {
        let db = self.0.lock().map_err(|e| e.to_string())?;
        let mut q = db
            .prepare("SELECT key,updated FROM sync_meta WHERE kind=?1")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([kind], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }
    pub fn apply_sync(
        &self,
        books: &[(Book, i64)],
        progress: &[Progress],
        deletions: &std::collections::BTreeMap<String, i64>,
        extensions: &std::collections::BTreeMap<String, i64>,
    ) -> Result<()> {
        let mut db = self.0.lock().map_err(|e| e.to_string())?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        for (book, updated) in books {
            let local_stamp: i64 = tx
                .query_row(
                    "SELECT updated FROM sync_meta WHERE kind='book' AND key=?1",
                    [&book.id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let deleted_stamp: i64 = tx
                .query_row(
                    "SELECT updated FROM sync_meta WHERE kind='deleted' AND key=?1",
                    [format!("book:{}", book.id)],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if local_stamp > *updated || deleted_stamp >= *updated && deleted_stamp > 0 {
                continue;
            }
            tx.execute(
                "INSERT OR REPLACE INTO books VALUES(?1,?2)",
                params![
                    book.id,
                    serde_json::to_string(book).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT OR REPLACE INTO sync_meta VALUES('book',?1,?2)",
                params![book.id, updated],
            )
            .map_err(|e| e.to_string())?;
        }
        for p in progress {
            tx.execute(
                "INSERT INTO progress VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book,chapter) DO UPDATE SET page=excluded.page,completed=MAX(progress.completed,excluded.completed),updated=excluded.updated WHERE excluded.updated>=CASE WHEN progress.updated<1000000000000 THEN progress.updated*1000 ELSE progress.updated END",
                params![p.book_id, p.chapter_id, p.page, p.completed, p.updated],
            )
            .map_err(|e| e.to_string())?;
        }
        for (key, updated) in deletions {
            tx.execute(
                "INSERT OR REPLACE INTO sync_meta VALUES('deleted',?1,?2)",
                params![key, updated],
            )
            .map_err(|e| e.to_string())?;
            if let Some(id) = key.strip_prefix("book:") {
                let stamp: i64 = tx
                    .query_row(
                        "SELECT updated FROM sync_meta WHERE kind='book' AND key=?1",
                        [id],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if stamp > *updated {
                    continue;
                }
                tx.execute("DELETE FROM books WHERE id=?1", [id])
                    .map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM progress WHERE book=?1", [id])
                    .map_err(|e| e.to_string())?;
            }
        }
        for (id, updated) in extensions {
            tx.execute(
                "INSERT OR REPLACE INTO sync_meta VALUES('extension',?1,?2)",
                params![id, updated],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn progress_upserts_and_settings_roundtrip() {
        let s = Store::open(Path::new(":memory:")).unwrap();
        let mut p = Progress {
            book_id: "b".into(),
            chapter_id: "c".into(),
            page: 2,
            completed: false,
            updated: 1,
        };
        s.save_progress(&p).unwrap();
        p.page = 9;
        p.completed = true;
        s.save_progress(&p).unwrap();
        let rows = s.progress().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].page, 9);
        assert!(rows[0].completed);
        p.page = 1;
        p.completed = false;
        s.save_progress(&p).unwrap();
        assert!(
            s.progress().unwrap()[0].completed,
            "Rereading preserves completed status"
        );
        let mut cfg = Settings::default();
        cfg.direction = "rtl".into();
        s.save_settings(&cfg).unwrap();
        assert_eq!(s.settings().unwrap().direction, "rtl");
    }
}
