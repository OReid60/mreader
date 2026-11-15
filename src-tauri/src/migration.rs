//! Read-only Mihon/Tachiyomi gzip-protobuf preview; import is a separate command.
//! Field numbers follow Mihon's official Backup* model definitions.
use crate::{model::*, store::Store};
use prost::Message;
use serde::Serialize;
use sha2::{Digest,Sha256};
use std::io::Read;
type Result<T> = std::result::Result<T,String>;
#[derive(Clone,PartialEq,Message)]
pub struct Backup {
 #[prost(message,repeated,tag="1")] pub manga:Vec<Manga>,
 #[prost(message,repeated,tag="2")] pub categories:Vec<Category>,
 #[prost(message,repeated,tag="101")] pub sources:Vec<Source>,
 #[prost(message,repeated,tag="106")] pub repositories:Vec<Repository>,
}
#[derive(Clone,PartialEq,Message)]
pub struct Manga {
 #[prost(int64,tag="1")] pub source:i64,
 #[prost(string,tag="2")] pub url:String,
 #[prost(string,tag="3")] pub title:String,
 #[prost(string,optional,tag="5")] pub author:Option<String>,
 #[prost(string,optional,tag="6")] pub description:Option<String>,
 #[prost(string,repeated,tag="7")] pub genres:Vec<String>,
 #[prost(int32,tag="8")] pub status:i32,
 #[prost(message,repeated,tag="16")] pub chapters:Vec<BackupChapter>,
 #[prost(int64,repeated,packed="false",tag="17")] pub categories:Vec<i64>,
 #[prost(bool,optional,tag="100")] pub favorite:Option<bool>,
 #[prost(message,repeated,tag="104")] pub history:Vec<History>,
}
#[derive(Clone,PartialEq,Message)]
pub struct BackupChapter {
 #[prost(string,tag="1")] pub url:String,
 #[prost(string,tag="2")] pub name:String,
 #[prost(string,optional,tag="3")] pub group:Option<String>,
 #[prost(bool,tag="4")] pub read:bool,
 #[prost(int64,tag="6")] pub page:i64,
 #[prost(float,tag="9")] pub number:f32,
}
#[derive(Clone,PartialEq,Message)] pub struct Category {
 #[prost(string,tag="1")] pub name:String,
 #[prost(int64,tag="2")] pub order:i64,
 #[prost(int64,tag="3")] pub id:i64,
}
#[derive(Clone,PartialEq,Message)] pub struct Source {
 #[prost(string,tag="1")] pub name:String,
 #[prost(int64,tag="2")] pub id:i64,
}
#[derive(Clone,PartialEq,Message)] pub struct Repository {
 #[prost(string,tag="1")] pub url:String,
 #[prost(string,tag="2")] pub name:String,
 #[prost(string,tag="5")] pub key:String,
}
#[derive(Clone,PartialEq,Message)] pub struct History {
 #[prost(string,tag="1")] pub url:String,
 #[prost(int64,tag="2")] pub read:i64,
}
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct Preview { pub manga:Vec<Entry>,pub categories:Vec<String>,pub sources:Vec<SourceEntry>,pub repositories:Vec<RepoEntry>,pub read:usize,pub chapters:usize,pub warnings:Vec<String> }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct Entry {pub title:String,pub source_id:String,pub source:String,pub chapters:usize,pub read:usize,pub in_progress:usize,pub unread:usize,pub category:String,pub installed:bool,pub existing:bool}
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct SourceEntry {pub id:String,pub name:String,pub installed:bool,pub packages:Vec<String>}
#[derive(Serialize)] pub struct RepoEntry {pub url:String,pub name:String,pub fingerprint:String}
pub fn decode(bytes:&[u8])->Result<Backup>{
 if bytes.len()>32*1024*1024{return Err("Backup exceeds 32 MiB".into())}
 let mut plain=Vec::new();
 if bytes.starts_with(&[0x1f,0x8b]) {flate2::read::GzDecoder::new(bytes).take(128*1024*1024+1).read_to_end(&mut plain).map_err(|e|format!("Invalid compressed backup: {e}"))?;}else{plain.extend_from_slice(bytes);}
 if plain.len()>128*1024*1024{return Err("Expanded backup exceeds 128 MiB".into())}
 let b=Backup::decode(plain.as_slice()).map_err(|e|format!("Unsupported or damaged Mihon backup: {e}"))?;
 if b.manga.is_empty()||b.manga.len()>50_000{return Err("Backup contains no manga or too many entries".into())}
 if b.manga.iter().map(|m|m.chapters.len()).sum::<usize>()>2_000_000{return Err("Backup contains too many chapters".into())}
 Ok(b)
}
fn id(m:&Manga)->String{format!("apk:{}:{:x}",m.source,Sha256::digest(m.url.as_bytes()))}
fn category<'a>(b:&'a Backup,m:&Manga)->&'a str{m.categories.first().and_then(|id|b.categories.iter().find(|c|c.id==*id||(c.id==0&&c.order==*id))).map(|c|c.name.as_str()).unwrap_or("Default")}
pub fn preview(b:&Backup,store:&Store,apk:&crate::apk::State)->Result<Preview>{
 let existing=store.books()?;let mut sources=Vec::new();let mut manga=Vec::new();
 for m in b.manga.iter().filter(|m|m.favorite.unwrap_or(true)){
  let sid=m.source.to_string();let name=b.sources.iter().find(|s|s.id==m.source).map(|s|s.name.clone()).unwrap_or_else(||format!("Source {sid}"));
  let installed=apk.installed.iter().any(|e|e.extension.sources.iter().any(|s|s.id==sid));
  if !sources.iter().any(|s:&SourceEntry|s.id==sid){let packages=apk.repositories.iter().flat_map(|r|&r.catalog.extensions).filter(|e|e.sources.iter().any(|s|s.id==sid)).map(|e|e.name.clone()).collect();sources.push(SourceEntry{id:sid.clone(),name:name.clone(),installed,packages});}
  let read=m.chapters.iter().filter(|c|c.read).count();let in_progress=m.chapters.iter().filter(|c|!c.read&&c.page>0).count();
  manga.push(Entry{title:m.title.clone(),source_id:sid,source:name,chapters:m.chapters.len(),read,in_progress,unread:m.chapters.len()-read-in_progress,category:category(b,m).into(),installed,existing:existing.iter().any(|old|old.id==id(m))});
 }
 let chapters=manga.iter().map(|m|m.chapters).sum();let read=manga.iter().map(|m|m.read).sum();
 let mut warnings=vec!["Backups contain library/progress metadata, not downloaded pages, extension APKs, or source login sessions. Install missing sources in Settings before reading.".into()];
 if b.manga.iter().any(|m|m.categories.len()>1){warnings.push("Mreader currently uses the first category assigned to each title.".into());}
 Ok(Preview{manga,categories:b.categories.iter().map(|c|c.name.clone()).collect(),sources,repositories:b.repositories.iter().map(|r|RepoEntry{url:r.url.clone(),name:r.name.clone(),fingerprint:r.key.clone()}).collect(),read,chapters,warnings})
}
pub fn import(b:&Backup,store:&Store)->Result<usize>{
 // One SQLite transaction makes confirmation atomic, including category records.
 let mut db=store.0.lock().map_err(|e|e.to_string())?;let tx=db.transaction().map_err(|e|e.to_string())?;let mut count=0;
 for m in b.manga.iter().filter(|m|m.favorite.unwrap_or(true)){
  if m.title.trim().is_empty()||m.url.is_empty(){continue;}
  let book_id=id(m);let old:Option<String>=tx.query_row("SELECT data FROM books WHERE id=?1",[&book_id],|r|r.get(0)).ok();
  let mut book=if let Some(text)=old{serde_json::from_str::<Book>(&text).map_err(|e|e.to_string())?}else{Book{id:book_id.clone(),title:m.title.clone(),author:m.author.clone().unwrap_or_default(),description:m.description.clone().unwrap_or_default(),source:format!("apk:{}",m.source),remote_id:m.url.clone(),cover:serde_json::json!({"mangaUrl":m.url,"mangaTitle":m.title}).to_string(),path:String::new(),status:match m.status{1=>"Ongoing",2=>"Completed",6=>"Hiatus",_=>"Unknown"}.into(),tags:m.genres.iter().filter(|t|!t.starts_with("mreader:")).cloned().collect(),chapters:vec![],favorite:false}};
  let cat=category(b,m);if cat!="Default"&&crate::categories::validate(cat).is_ok(){if !book.tags.iter().any(|t|t.starts_with("mreader:category:")){book.tags.push(format!("mreader:category:{cat}"));}tx.execute("INSERT OR IGNORE INTO sync_meta VALUES('category',?1,?2)",rusqlite::params![cat,now_ms()]).map_err(|e|e.to_string())?;}
  for c in &m.chapters{
   if c.url.is_empty(){continue;}
   if !book.chapters.iter().any(|old|old.id==c.url){book.chapters.push(Chapter{id:c.url.clone(),title:c.name.clone(),number:if c.number.is_finite(){c.number.to_string()}else{String::new()},pages:0,path:String::new(),downloaded:false,group:c.group.clone().unwrap_or_default()});}
   if c.read||c.page>0||m.history.iter().any(|h|h.url==c.url){
    let stamp=m.history.iter().find(|h|h.url==c.url).map(|h|h.read.max(1)).unwrap_or(1);
    tx.execute("INSERT INTO progress VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book,chapter) DO UPDATE SET completed=MAX(progress.completed,excluded.completed),page=CASE WHEN excluded.updated>progress.updated THEN excluded.page ELSE progress.page END,updated=MAX(progress.updated,excluded.updated)",rusqlite::params![book_id,c.url,c.page.clamp(0,100_000),c.read,stamp]).map_err(|e|e.to_string())?;
   }
  }
  book.chapters.sort_by(|a,b|a.number.parse::<f64>().unwrap_or(-1.).total_cmp(&b.number.parse::<f64>().unwrap_or(-1.)));
  tx.execute("INSERT INTO books VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",rusqlite::params![book_id,serde_json::to_string(&book).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
  tx.execute("INSERT OR REPLACE INTO sync_meta VALUES('book',?1,?2)",rusqlite::params![book_id,now_ms()]).map_err(|e|e.to_string())?;count+=1;
 }
 tx.commit().map_err(|e|e.to_string())?;Ok(count)
}
#[cfg(test)] mod tests{
 use super::*;
 #[test] fn migration_preview_is_read_only_and_import_is_idempotent(){let m=Manga{source:123,url:"/m".into(),title:"Fixture".into(),favorite:Some(true),chapters:vec![BackupChapter{url:"/c".into(),name:"Chapter".into(),read:true,page:4,number:1.,..Default::default()}],..Default::default()};let b=Backup{manga:vec![m],..Default::default()};let decoded=decode(&b.encode_to_vec()).unwrap();let s=Store::open(std::path::Path::new(":memory:")).unwrap();assert_eq!(preview(&decoded,&s,&Default::default()).unwrap().read,1);assert!(s.books().unwrap().is_empty());import(&decoded,&s).unwrap();import(&decoded,&s).unwrap();assert_eq!(s.books().unwrap().len(),1);assert!(s.progress().unwrap()[0].completed);assert!(!s.books().unwrap()[0].chapters[0].downloaded);}
 #[test] fn corrupt_backup_is_rejected(){assert!(decode(b"not a backup").is_err());}
 #[test] #[ignore="Reads an explicitly supplied local backup without importing"] fn inspect_user_backup(){let path=std::env::var("MREADER_MIHON_BACKUP").unwrap();let b=decode(&std::fs::read(path).unwrap()).unwrap();let s=Store::open(std::path::Path::new(":memory:")).unwrap();let p=preview(&b,&s,&Default::default()).unwrap();println!("MIHON SUMMARY: {} manga / {} chapters / {} read / {} sources / {} repositories",p.manga.len(),p.chapters,p.read,p.sources.len(),p.repositories.len());}
}
