//! Device-local durable download scheduling. No WebView timer owns a transfer.
use crate::{Core,Result};
use serde::{Serialize,Deserialize};
use std::sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}};
use tauri::{Emitter,Manager};
#[derive(Clone,Serialize,Deserialize,Default)] #[serde(rename_all="camelCase")]
pub struct Job {pub id:String,pub title:String,pub pending:Vec<String>,pub total:usize,pub done:usize,pub failed:Vec<Failure>,pub active:Option<String>,pub cancelled:bool,pub paused:bool,pub page_done:usize,pub page_total:usize}
#[derive(Clone,Serialize,Deserialize)] pub struct Failure {pub id:String,pub error:String}
#[derive(Default)] pub struct Queue {pub jobs:Mutex<Vec<Job>>,pub running:AtomicBool,pub interrupt:tokio::sync::Notify}
impl Queue{
 pub fn load(&self,store:&crate::store::Store)->Result<()>{
  let mut jobs:Vec<Job>=store.queue_load()?;
  for j in &mut jobs{if let Some(id)=j.active.take(){j.pending.insert(0,id);}if !j.pending.is_empty(){j.paused=true;}j.page_done=0;j.page_total=0;}
  store.queue_save(&jobs)?;*self.jobs.lock().map_err(|e|e.to_string())?=jobs;Ok(())
 }
 pub fn busy(&self)->bool{self.running.load(Ordering::SeqCst)||self.jobs.lock().map(|jobs|jobs.iter().any(|j|j.active.is_some()||(!j.paused&&!j.pending.is_empty()))).unwrap_or(true)}
 pub fn state(&self)->Result<Vec<Job>>{Ok(self.jobs.lock().map_err(|e|e.to_string())?.clone())}
}
fn announce(app:&tauri::AppHandle,core:&Core)->Result<Vec<Job>>{let jobs=core.queue.state()?;core.store.queue_save(&jobs)?;let _=app.emit("download-queue",&jobs);Ok(jobs)}
pub fn page_progress(app:&tauri::AppHandle,core:&Core,id:&str,done:usize,total:usize){
 let mut text=None;
 if let Ok(mut jobs)=core.queue.jobs.lock(){if let Some(j)=jobs.iter_mut().find(|j|j.active.as_deref()==Some(id)){j.page_done=done;j.page_total=total;text=Some((format!("{} · {}/{} chapters · {done}/{total} pages",j.title,j.done,j.total),j.done,j.total));}}
 let _=app.emit("download-queue",core.queue.state().unwrap_or_default());
 if let Some((text,done,total))=text{let _=platform(app,true,&text,done,total);}
}
#[tauri::command]
pub async fn download_enqueue(app:tauri::AppHandle,core:tauri::State<'_,Arc<Core>>,book_id:String,chapter_ids:Option<Vec<String>>,unread_only:bool)->Result<Vec<Job>>{
 let _guard=core.cloud.gate.lock().await;
 let b=core.store.book(&book_id)?;if b.source=="local"{return Err("Local manga is already available offline".into())}
 let progress=core.store.progress()?;
 let ids:Vec<String>=b.chapters.iter().filter(|c|!c.downloaded&&chapter_ids.as_ref().is_none_or(|ids|ids.contains(&c.id))&&(!unread_only||!progress.iter().any(|p|p.book_id==b.id&&p.chapter_id==c.id&&p.completed))).map(|c|c.id.clone()).collect();
 if ids.is_empty(){return core.queue.state();}
 platform(&app,true,"Preparing manga downloads",0,ids.len())?;
 {let mut jobs=core.queue.jobs.lock().map_err(|e|e.to_string())?;
  if let Some(j)=jobs.iter_mut().find(|j|j.id==b.id){
   if j.active.is_none(){*j=Job{id:b.id.clone(),title:b.title.clone(),total:ids.len(),pending:ids,..Default::default()};}
   else{
   let fresh:Vec<_>=ids.into_iter().filter(|id|!j.pending.contains(id)&&j.active.as_ref()!=Some(id)).collect();
   j.pending.extend(fresh);j.total=j.done+j.pending.len()+1;j.cancelled=false;j.paused=false;j.failed.clear();}
  }else{jobs.push(Job{id:b.id,title:b.title,total:ids.len(),pending:ids,..Default::default()});}
 }
 let state=announce(&app,&core)?;start(app,core.inner().clone());Ok(state)
}
#[tauri::command]
pub fn download_queue(core:tauri::State<Arc<Core>>)->Result<Vec<Job>>{core.queue.state()}
#[tauri::command]
pub fn download_stop(app:tauri::AppHandle,core:tauri::State<Arc<Core>>,book_id:String)->Result<Vec<Job>>{
 {let mut jobs=core.queue.jobs.lock().map_err(|e|e.to_string())?;if let Some(j)=jobs.iter_mut().find(|j|j.id==book_id){j.paused=true;j.cancelled=true;}}
 announce(&app,&core)
}
pub fn start(app:tauri::AppHandle,core:Arc<Core>){
 if core.queue.running.swap(true,Ordering::SeqCst){return;}
 crate::shutdown_trace::event("download.worker.start");
 tauri::async_runtime::spawn(async move{
  loop{
   let next={let mut jobs=match core.queue.jobs.lock(){Ok(j)=>j,Err(_)=>break};
    jobs.iter_mut().find(|j|!j.paused&&!j.pending.is_empty()).map(|j|{let id=j.pending.remove(0);j.active=Some(id.clone());j.page_done=0;j.page_total=0;(j.id.clone(),id)})};
   let Some((book,chapter))=next else{break};
   crate::shutdown_trace::event("download.chapter.begin");
   if announce(&app,&core).is_err(){break;}
   let key=format!("{book}:{chapter}");
   let result=if core.downloads.lock().map(|mut d|d.insert(key.clone())).unwrap_or(false){
    let result=match futures_util::future::select(Box::pin(crate::download(Some(&app),&core,&book,&chapter)),Box::pin(core.queue.interrupt.notified())).await{futures_util::future::Either::Left((r,_))=>r,_=>Err("Background service paused. Resume this queue in Downloads.".into())};
    if let Ok(mut d)=core.downloads.lock(){d.remove(&key);}result
   }else{Err("Chapter already downloading; retry when it finishes".into())};
   if let Ok(mut jobs)=core.queue.jobs.lock(){if let Some(j)=jobs.iter_mut().find(|j|j.id==book){j.active=None;match result{Ok(_)=>j.done+=1,Err(error)=>j.failed.push(Failure{id:chapter,error})};}}
   let _=announce(&app,&core);
   crate::shutdown_trace::event("download.chapter.finished");
  }
  let _=platform(&app,false,"Downloads paused or complete",0,0);
  let _=announce(&app,&core);
  core.queue.running.store(false,Ordering::SeqCst);
  crate::shutdown_trace::event("download.worker.idle");
  // Enqueue can race the final iteration; check again after releasing ownership.
  let restart=core.queue.jobs.lock().map(|j|j.iter().any(|j|!j.paused&&!j.pending.is_empty())).unwrap_or(false);
  if restart{let _=platform(&app,true,"Continuing downloads",0,0);start(app,core);}
 });
}
#[cfg(not(target_os="android"))]
fn platform(_: &tauri::AppHandle,_:bool,_:&str,_:usize,_:usize)->Result<()>{Ok(())}
#[cfg(target_os="android")]
fn platform(_: &tauri::AppHandle,active:bool,text:&str,done:usize,total:usize)->Result<()>{
 use jni::{JavaVM,objects::{JClass,JObject,JValue}};
 let context=ndk_context::android_context();let vm=unsafe{JavaVM::from_raw(context.vm().cast())}.map_err(|e|e.to_string())?;let mut env=vm.attach_current_thread().map_err(|e|e.to_string())?;
 let result=(||{let activity=unsafe{JObject::from_raw(context.context().cast())};let loader=env.call_method(&activity,"getClassLoader","()Ljava/lang/ClassLoader;",&[]).and_then(|v|v.l()).map_err(|e|e.to_string())?;
 let name=JObject::from(env.new_string("app.mreader.desktop.DownloadService").map_err(|e|e.to_string())?);let class=JClass::from(env.call_method(loader,"loadClass","(Ljava/lang/String;)Ljava/lang/Class;",&[JValue::Object(&name)]).and_then(|v|v.l()).map_err(|e|e.to_string())?);let text=JObject::from(env.new_string(text).map_err(|e|e.to_string())?);
 env.call_static_method(class,"update","(Landroid/content/Context;ZLjava/lang/String;II)V",&[JValue::Object(&activity),JValue::Bool(active as u8),JValue::Object(&text),JValue::Int(done as i32),JValue::Int(total as i32)]).map_err(|e|format!("Android could not start background downloads: {e}. Open Mreader and retry."))?;Ok(())})();if result.is_err(){let _=env.exception_clear();}result
}
#[cfg(target_os="android")]
pub static APP:std::sync::OnceLock<tauri::AppHandle>=std::sync::OnceLock::new();
#[cfg(target_os="android")]
#[no_mangle]
pub extern "system" fn Java_app_mreader_desktop_DownloadService_pauseNative(_:jni::JNIEnv,_:jni::objects::JClass){
 if let Some(app)=APP.get(){let core=app.state::<Arc<Core>>();if let Ok(mut jobs)=core.queue.jobs.lock(){for j in jobs.iter_mut(){j.paused=true;}}let _=announce(app,&core);core.queue.interrupt.notify_one();}
}
#[cfg(test)]mod tests{use super::*;#[test]fn interrupted_queue_restores_paused_and_profile_local(){let s=crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();let q=Queue::default();s.queue_save(&vec![Job{id:"b".into(),active:Some("c1".into()),pending:vec!["c2".into()],total:2,..Default::default()}]).unwrap();q.load(&s).unwrap();let jobs=q.state().unwrap();assert_eq!(jobs[0].pending,vec!["c1","c2"]);assert!(jobs[0].paused);assert!(!q.busy());let other=crate::store::Store::open(std::path::Path::new(":memory:")).unwrap();q.load(&other).unwrap();assert!(q.state().unwrap().is_empty());}}
