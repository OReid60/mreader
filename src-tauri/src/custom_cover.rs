//! Portable, bounded user cover art. The database is authoritative; files support older installs.
use std::path::{Path,PathBuf};
use sha2::{Digest,Sha256};
use base64::{engine::general_purpose::STANDARD,Engine};
use serde::{Serialize,Deserialize};
type Result<T>=std::result::Result<T,String>;
const MAX_JPEG:usize=96*1024;
pub fn upload_body(body:&tauri::ipc::InvokeBody)->Result<Vec<u8>>{
 const MAX_INPUT:usize=10*1024*1024;
 match body{
  tauri::ipc::InvokeBody::Raw(bytes) if bytes.len()<=MAX_INPUT=>Ok(bytes.clone()),
  // Android's authenticated postMessage transport serializes binary payloads
  // as JSON byte arrays. Desktop's custom-protocol transport uses Raw bytes.
  tauri::ipc::InvokeBody::Json(serde_json::Value::Array(values)) if values.len()<=MAX_INPUT=>values.iter().map(|v|v.as_u64().and_then(|n|u8::try_from(n).ok()).ok_or_else(||"Invalid cover image upload".to_string())).collect(),
  tauri::ipc::InvokeBody::Raw(_)|tauri::ipc::InvokeBody::Json(serde_json::Value::Array(_))=>Err("Choose an image smaller than 10 MiB".into()),
  _=>Err("Invalid cover image upload".into())
 }
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(rename_all="camelCase")]
pub struct Cover { pub jpeg:String, pub updated_at:i64 }
impl Cover {
 pub fn new(jpeg:&[u8],updated_at:i64)->Result<Self>{let cover=Self{jpeg:STANDARD.encode(jpeg),updated_at};cover.validate()?;Ok(cover)}
 pub fn bytes(&self)->Result<Vec<u8>>{if self.jpeg.len()>MAX_JPEG*4/3+4{return Err("Custom cover is too large".into())}STANDARD.decode(&self.jpeg).map_err(|_|"Invalid custom cover encoding".into())}
 pub fn validate(&self)->Result<()>{
  if self.updated_at<1{return Err("Invalid custom cover timestamp".into())}
  let bytes=self.bytes()?;if bytes.len()>MAX_JPEG||image::guess_format(&bytes).ok()!=Some(image::ImageFormat::Jpeg){return Err("Invalid custom cover image".into())}
  let reader=image::ImageReader::with_format(std::io::Cursor::new(&bytes),image::ImageFormat::Jpeg);
  let (w,h)=reader.into_dimensions().map_err(|e|e.to_string())?;
  if w==0||h==0||w>512||h>768{return Err("Invalid custom cover dimensions".into())}Ok(())
 }
}
/// Separate cover timestamps prevent a newer metadata refresh from erasing a chosen image.
pub fn merge(target:&mut Option<Cover>,incoming:&Option<Cover>){
 if let Some(next)=incoming{if target.as_ref().map(|old|(next.updated_at,&next.jpeg)>(old.updated_at,&old.jpeg)).unwrap_or(true){*target=Some(next.clone())}}
}
pub fn migrate(profile:&Path,store:&crate::store::Store)->Result<()>{
 for mut book in store.books()?{if book.custom_cover.is_some(){continue}let file=path(profile,&book.id);
  if let Ok(bytes)=std::fs::read(&file){let stamp=std::fs::metadata(&file).and_then(|m|m.modified()).ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis() as i64).unwrap_or(1).max(1);
   book.custom_cover=Some(Cover::new(&encode(bytes)?,stamp)?);store.put(&book)?;
  }
 }Ok(())
}
pub fn path(profile:&Path,book_id:&str)->PathBuf{profile.join("custom-covers").join(format!("{:x}.jpg",Sha256::digest(book_id.as_bytes())))}
fn encode(bytes:Vec<u8>)->Result<Vec<u8>>{
 if bytes.is_empty()||bytes.len()>10*1024*1024{return Err("Choose an image smaller than 10 MiB".into())}
 let mut reader=image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().map_err(|e|e.to_string())?;
 let mut limits=image::Limits::default();limits.max_alloc=Some(128*1024*1024);limits.max_image_width=Some(8192);limits.max_image_height=Some(8192);reader.limits(limits);
 let mut image=reader.decode().map_err(|e|format!("Cannot read this cover image: {e}"))?.thumbnail(512,768).to_rgb8();
 loop {let mut jpeg=Vec::new();image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg,85).encode_image(&image).map_err(|e|e.to_string())?;
  if jpeg.len()<=MAX_JPEG{return Ok(jpeg)}
  image=image::imageops::resize(&image,(image.width()*3/4).max(1),(image.height()*3/4).max(1),image::imageops::FilterType::Triangle);
 }
}
pub async fn save(profile:PathBuf,book_id:String,bytes:Vec<u8>)->Result<Vec<u8>>{
 let jpeg=tauri::async_runtime::spawn_blocking(move||encode(bytes)).await.map_err(|e|e.to_string())??;
 let destination=path(&profile,&book_id);tokio::fs::create_dir_all(destination.parent().ok_or("Invalid cover location")?).await.map_err(|e|e.to_string())?;
 let temporary=destination.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));
 tokio::fs::write(&temporary,&jpeg).await.map_err(|e|e.to_string())?;
 if let Err(error)=tokio::fs::rename(&temporary,&destination).await{let _=tokio::fs::remove_file(&temporary).await;return Err(error.to_string())}Ok(jpeg)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn android_json_and_desktop_raw_uploads_are_equivalent_and_bounded(){
  use tauri::ipc::InvokeBody;
  assert_eq!(upload_body(&InvokeBody::Raw(vec![0,42,255])).unwrap(),upload_body(&InvokeBody::Json(serde_json::json!([0,42,255]))).unwrap());
  for value in [serde_json::json!([-1]),serde_json::json!([256]),serde_json::json!([1.5]),serde_json::json!([true]),serde_json::json!({})]{assert!(upload_body(&InvokeBody::Json(value)).is_err());}
  assert!(upload_body(&InvokeBody::Raw(vec![0;10*1024*1024+1])).is_err());
 }
 #[test]fn rejects_invalid_images_and_bounds_paths(){assert!(encode(b"not an image".to_vec()).is_err());assert!(encode(vec![0;10*1024*1024+1]).is_err());let profile=Path::new("profile");assert_eq!(path(profile,"../../outside").parent().unwrap(),profile.join("custom-covers"));assert_ne!(path(profile,"a"),path(profile,"b"));}
 #[test]fn persists_decodable_cover_without_replacing_on_failure(){tauri::async_runtime::block_on(async{let root=std::env::temp_dir().join(format!("mreader-cover-{}",uuid::Uuid::new_v4()));let image=image::RgbImage::new(1200,1800);let mut input=Vec::new();image::codecs::jpeg::JpegEncoder::new(&mut input).encode_image(&image).unwrap();let jpeg=save(root.clone(),"book".into(),input).await.unwrap();let decoded=image::load_from_memory(&jpeg).unwrap();assert!(decoded.width()<=512&&decoded.height()<=768);assert!(save(root.clone(),"book".into(),b"invalid".to_vec()).await.is_err());assert_eq!(std::fs::read(path(&root,"book")).unwrap(),jpeg);std::fs::remove_dir_all(root).unwrap();});}
 #[test]fn portable_covers_roundtrip_validate_and_merge_independently(){
  let mut bytes=Vec::new();image::codecs::jpeg::JpegEncoder::new(&mut bytes).encode_image(&image::RgbImage::new(12,18)).unwrap();
  let first=Cover::new(&bytes,10).unwrap();assert_eq!(first.bytes().unwrap(),bytes);
  let second=Cover{updated_at:20,..first.clone()};let mut chosen=Some(second.clone());merge(&mut chosen,&Some(first));assert_eq!(chosen,Some(second.clone()));merge(&mut chosen,&None);assert_eq!(chosen,Some(second.clone()));
  assert_eq!(serde_json::from_str::<Cover>(&serde_json::to_string(&second).unwrap()).unwrap(),second);
  assert!(Cover{jpeg:"bad".into(),updated_at:1}.validate().is_err());assert!(Cover{updated_at:0,..second}.validate().is_err());
 }
 #[test]fn legacy_files_migrate_once_without_touching_reading_progress(){tauri::async_runtime::block_on(async{
  let root=std::env::temp_dir().join(format!("mreader-cover-migration-{}",uuid::Uuid::new_v4()));std::fs::create_dir_all(&root).unwrap();
  let store=crate::store::Store::open(&root.join("library.sqlite")).unwrap();let book:crate::model::Book=serde_json::from_value(serde_json::json!({"id":"book","title":"Fixture","source":"local"})).unwrap();store.put(&book).unwrap();
  let mut bytes=Vec::new();image::codecs::jpeg::JpegEncoder::new(&mut bytes).encode_image(&image::RgbImage::new(12,18)).unwrap();save(root.clone(),"book".into(),bytes).await.unwrap();
  let before=serde_json::to_string(&store.progress().unwrap()).unwrap();migrate(&root,&store).unwrap();let cover=store.book("book").unwrap().custom_cover.unwrap();migrate(&root,&store).unwrap();assert_eq!(store.book("book").unwrap().custom_cover,Some(cover));assert_eq!(before,serde_json::to_string(&store.progress().unwrap()).unwrap());drop(store);std::fs::remove_dir_all(root).unwrap();
 });}
}
