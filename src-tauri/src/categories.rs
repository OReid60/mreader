//! Category names are library metadata; assignments remain compatible book tags.
use crate::{model::now_ms, store::Store};
use std::collections::BTreeMap;
type Result<T> = std::result::Result<T, String>;
pub fn validate(name: &str) -> Result<()> {
    if name.trim() != name || name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
        return Err("Use a category name of 1–60 characters without control characters".into());
    }
    Ok(())
}
pub fn list(store: &Store) -> Result<Vec<String>> {
    let definitions = store.metadata("category")?;
    let deleted = store.metadata("deleted")?;
    let mut names = std::collections::BTreeSet::new();
    names.insert("nsfw".to_string());
    names.extend(definitions.keys().cloned());
    for book in store.books()? { for tag in book.tags { if let Some(name) = tag.strip_prefix("mreader:category:") { if validate(name).is_ok() { names.insert(name.into()); } } } }
    names.retain(|name| name != "Default" && deleted.get(&format!("category:{name}")).is_none_or(|stamp| definitions.get(name).is_some_and(|t| t > stamp)));
    Ok(std::iter::once("Default".into()).chain(names).collect())
}
pub fn edit(store: &Store, action: &str, name: &str, replacement: &str) -> Result<()> {
    validate(name)?;
    let names = list(store)?;
    if action == "create" {
        if names.iter().any(|n| n.eq_ignore_ascii_case(name)) { return Err("This category already exists".into()); }
        if names.len() >= 100 { return Err("You can have up to 100 categories".into()); }
    } else {
        if name == "Default" || !names.iter().any(|n| n == name) { return Err("Choose an existing custom category".into()); }
        if action == "rename" { validate(replacement)?; if names.iter().any(|n| n.eq_ignore_ascii_case(replacement)) { return Err("This category already exists".into()); } }
        else if action != "delete" { return Err("Unknown category action".into()); }
    }
    let mut books = store.books()?;
    let previous = store.metadata("category")?.values().chain(store.metadata("deleted")?.values()).copied().max().unwrap_or(0);
    let stamp = now_ms().max(previous.saturating_add(1));
    let mut db = store.0.lock().map_err(|e| e.to_string())?;
    let tx = db.transaction().map_err(|e| e.to_string())?;
    if action != "create" {
        let tag = format!("mreader:category:{name}");
        for book in &mut books {
            if !book.tags.contains(&tag) { continue; }
            book.tags.retain(|t| t != &tag);
            if action == "rename" { book.tags.push(format!("mreader:category:{replacement}")); }
            tx.execute("UPDATE books SET data=?2 WHERE id=?1", rusqlite::params![book.id,serde_json::to_string(book).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
            tx.execute("INSERT OR REPLACE INTO sync_meta VALUES('book',?1,?2)",rusqlite::params![book.id,stamp]).map_err(|e|e.to_string())?;
        }
        tx.execute("INSERT OR REPLACE INTO sync_meta VALUES('deleted',?1,?2)",rusqlite::params![format!("category:{name}"),stamp]).map_err(|e|e.to_string())?;
    }
    if action != "delete" {
        let target = if action == "create" { name } else { replacement };
        tx.execute("INSERT OR REPLACE INTO sync_meta VALUES('category',?1,?2)",rusqlite::params![target,stamp]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{cloud::Document, model::{Book, Progress}};
    #[test]
    fn groups_and_assignments_sync_rename_and_delete_without_losing_progress() {
        let a=Store::open(std::path::Path::new(":memory:")).unwrap();
        let b=Store::open(std::path::Path::new(":memory:")).unwrap();
        edit(&a,"create","Action & Adventure","").unwrap();
        edit(&a,"create","Empty group","").unwrap();
        let book:Book=serde_json::from_value(serde_json::json!({"id":"m","title":"Test","source":"mangadex","tags":["Action","mreader:category:Action & Adventure"]})).unwrap();
        a.put(&book).unwrap();
        a.save_progress(&Progress{book_id:"m".into(),chapter_id:"c".into(),page:3,completed:false,updated:now_ms()}).unwrap();
        let before=Document::from_store(&a,vec![]).unwrap();
        before.apply(&b).unwrap();
        assert!(list(&b).unwrap().contains(&"Empty group".into()));
        edit(&a,"rename","Action & Adventure","Adventure").unwrap();
        let renamed=Document::from_store(&a,vec![]).unwrap().merge(&before).unwrap();
        renamed.apply(&b).unwrap();
        assert!(!list(&b).unwrap().contains(&"Action & Adventure".into()));
        assert!(b.book("m").unwrap().tags.contains(&"mreader:category:Adventure".into()));
        edit(&a,"delete","Adventure","").unwrap();
        let deleted=Document::from_store(&a,vec![]).unwrap().merge(&renamed).unwrap();
        deleted.apply(&b).unwrap();
        assert!(!list(&b).unwrap().contains(&"Adventure".into()));
        assert_eq!(b.books().unwrap().len(),1);
        assert_eq!(b.progress().unwrap()[0].page,3);
        assert_eq!(b.book("m").unwrap().tags,vec!["Action"]);
        edit(&a,"create","Adventure","").unwrap();
        let recreated=Document::from_store(&a,vec![]).unwrap().merge(&deleted).unwrap();
        recreated.apply(&b).unwrap();
        assert!(list(&b).unwrap().contains(&"Adventure".into()));
    }
    #[test]
    fn category_validation_and_default_protection() {
        let store=Store::open(std::path::Path::new(":memory:")).unwrap();
        for name in ["","\n"," Default","bad\0name"] { assert!(validate(name).is_err()); }
        assert!(edit(&store,"delete","Default","").is_err());
        edit(&store,"create","Romance","").unwrap();
        assert!(edit(&store,"create","romance","").is_err());
        assert!(edit(&store,"rename","Romance","Default").is_err());
    }
}
pub fn apply(store: &Store, categories: &BTreeMap<String,i64>) -> Result<()> {
    let db = store.0.lock().map_err(|e|e.to_string())?;
    for (name,stamp) in categories { validate(name)?; db.execute("INSERT INTO sync_meta VALUES('category',?1,?2) ON CONFLICT(kind,key) DO UPDATE SET updated=MAX(updated,excluded.updated)",rusqlite::params![name,stamp]).map_err(|e|e.to_string())?; }
    Ok(())
}
