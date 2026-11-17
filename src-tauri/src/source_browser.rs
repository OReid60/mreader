//! User-driven verification; remote pages never receive reader IPC privileges.
use crate::{Core,Result};
use std::{collections::HashMap,path::PathBuf,sync::Mutex,time::Instant};
use tauri::Manager;
struct Session{source:String,url:tauri::Url,profile:PathBuf,opened:Instant}
#[derive(Default)] pub struct Service{sessions:Mutex<HashMap<String,Session>>}
fn permitted(base:&tauri::Url,url:&tauri::Url)->bool{url.scheme()=="https"&&url.username().is_empty()&&url.password().is_none()&&url.port_or_known_default()==base.port_or_known_default()&&url.host_str().map(|h|h.trim_start_matches("www."))==base.host_str().map(|h|h.trim_start_matches("www."))}
impl Service{
 pub async fn open(&self,core:&Core,app:&tauri::AppHandle,source:String)->Result<serde_json::Value>{
  let id=source.strip_prefix("apk:").ok_or("Browser verification is available for installed APK sources")?;
  let info=core.sources.apk.source_info(id).await?;
  let url=crate::apk::https_url(info["url"].as_str().ok_or("This source does not provide a website")?)?;
  let agent=info["userAgent"].as_str().ok_or("Source browser identity unavailable")?;
  let profile=core.cloud.profile_dir(&core.data)?;
  let label=format!("source-verification-{}",uuid::Uuid::new_v4());
  {let sessions=self.sessions.lock().map_err(|e|e.to_string())?;if sessions.len()>=4{return Err("Finish or cancel another verification session first".into());}}
  #[cfg(not(target_os="android"))]{
   let base=url.clone();let monitor=app.get_webview_window("main").ok_or("Reader window unavailable")?.current_monitor().map_err(|e|e.to_string())?.ok_or("Reader display unavailable")?;
   let scale=monitor.scale_factor();let position=monitor.position();let size=monitor.size();
   let window=tauri::WebviewWindowBuilder::new(app,&label,tauri::WebviewUrl::External(url.clone()))
    .title("Source verification — return to Mreader to finish")
    .user_agent(agent).data_directory(profile.join("verification-browser"))
    .inner_size((size.width as f64/scale-80.0).min(1100.0),(size.height as f64/scale-100.0).min(820.0))
    .position(position.x as f64/scale+30.0,position.y as f64/scale+30.0).focused(false)
    .on_navigation(move|next|permitted(&base,next))
    .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
    .on_download(|_,_|false)
    .build().map_err(|e|e.to_string())?;
   let hidden=window.clone();window.on_window_event(move|event|if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();let _=hidden.hide();});
  }
  #[cfg(target_os="android")]core.sources.apk.verification_open(id,url.as_str(),agent).await?;
  self.sessions.lock().map_err(|e|e.to_string())?.insert(label.clone(),Session{source:source.clone(),url,profile,opened:Instant::now()});
  Ok(serde_json::json!({"id":label,"source":source}))
 }
 pub async fn finish(&self,core:&Core,app:&tauri::AppHandle,id:String,cancel:bool)->Result<serde_json::Value>{
  let session=self.sessions.lock().map_err(|e|e.to_string())?.remove(&id).ok_or("Verification session expired; open it again")?;
  let window=app.get_webview_window(&id);
  if cancel{#[cfg(target_os="android")]core.sources.apk.verification_finish(session.source.trim_start_matches("apk:"),session.url.as_str(),Vec::new()).await?;if let Some(w)=window{let _=w.destroy();}return Ok(serde_json::json!({"cancelled":true}));}
  if session.profile!=core.cloud.profile_dir(&core.data)?||session.opened.elapsed().as_secs()>1800{if let Some(w)=window{let _=w.destroy();}return Err("Verification session expired or account changed".into());}
  #[cfg(not(target_os="android"))]
  let cookies={let w=window.as_ref().ok_or("Verification browser unavailable")?.clone();let url=session.url.clone();tauri::async_runtime::spawn_blocking(move||w.cookies_for_url(url).map(|cookies|cookies.into_iter().map(|c|c.to_string()).collect::<Vec<_>>()).map_err(|e|e.to_string())).await.map_err(|e|e.to_string())??};
  #[cfg(target_os="android")]let cookies=Vec::new();
  let result=core.sources.apk.verification_finish(session.source.trim_start_matches("apk:"),session.url.as_str(),cookies).await;
  if let Some(w)=window{let _=w.destroy();}result
 }
}
#[cfg(test)]mod tests{use super::*;#[test]fn navigation_is_source_bound(){let base=tauri::Url::parse("https://source.example/path").unwrap();assert!(permitted(&base,&tauri::Url::parse("https://www.source.example/check").unwrap()));for url in ["http://source.example/","https://other.example/","https://source.example:8443/","https://user:secret@source.example/","file:///private"]{assert!(!permitted(&base,&tauri::Url::parse(url).unwrap()));}}}
