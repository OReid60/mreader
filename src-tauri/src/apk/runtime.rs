use super::{Installed, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Default)]
pub struct Runtime {
    dir: Mutex<Option<PathBuf>>,
    loaded: tokio::sync::Mutex<std::collections::HashSet<String>>,
    #[cfg(not(target_os = "android"))]
    desktop: super::desktop::Desktop,
}
impl Runtime {
    pub fn stop(&self) {
        #[cfg(not(target_os = "android"))]
        self.desktop.stop();
    }
    pub fn set_dir(&self, dir: &Path) -> Result<()> {
        *self.dir.lock().map_err(|e| e.to_string())? = Some(dir.to_owned());
        #[cfg(not(target_os = "android"))]
        self.desktop.set_dir(dir)?;
        Ok(())
    }
    pub async fn load(&self, e: &Installed, dir: &Path) -> Result<()> {
        let mut loaded = self.loaded.lock().await;
        let key = format!("{}:{}", e.extension.package, e.extension.version_code);
        if loaded.contains(&key) {
            return Ok(());
        }
        self.call(json!({"operation":"load","path":dir.join(format!("{}-{}.apk",e.extension.package,e.extension.version_code)),"package":e.extension.package,"versionCode":e.extension.version_code,"signingKey":e.signing_key})).await?;
        loaded.insert(key);
        Ok(())
    }
    pub async fn call(&self, args: Value) -> Result<Value> {
        #[cfg(target_os = "android")]
        {
            tauri::async_runtime::spawn_blocking(move || android_call(args))
                .await
                .map_err(|e| e.to_string())?
        }
        #[cfg(not(target_os = "android"))]
        {
            self.desktop.call(args).await
        }
    }
    pub async fn image(&self, args: Value) -> Result<Vec<u8>> {
        #[cfg(target_os = "android")]
        {
            let result = self.call(args).await?;
            let path = result["path"]
                .as_str()
                .ok_or("Extension image cache missing")?;
            let bytes = tokio::fs::read(path).await.map_err(|e| e.to_string())?;
            if bytes.len() > 64 * 1024 * 1024 {
                return Err("Extension image exceeds 64 MiB".into());
            }
            Ok(bytes)
        }
        #[cfg(not(target_os = "android"))]
        {
            self.desktop.image(args).await
        }
    }
}

#[cfg(target_os = "android")]
fn android_call(args: Value) -> Result<Value> {
    use jni::{
        objects::{JClass, JObject, JString, JValue},
        JavaVM,
    };
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
    let result = (|| {
        let activity = unsafe { JObject::from_raw(context.context().cast()) };
        let loader = env
            .call_method(
                &activity,
                "getClassLoader",
                "()Ljava/lang/ClassLoader;",
                &[],
            )
            .and_then(|v| v.l())
            .map_err(|e| e.to_string())?;
        let name = JObject::from(
            env.new_string("app.mreader.desktop.ExtensionHost")
                .map_err(|e| e.to_string())?,
        );
        let class = JClass::from(
            env.call_method(
                loader,
                "loadClass",
                "(Ljava/lang/String;)Ljava/lang/Class;",
                &[JValue::Object(&name)],
            )
            .and_then(|v| v.l())
            .map_err(|e| e.to_string())?,
        );
        let args = JObject::from(
            env.new_string(args.to_string())
                .map_err(|e| e.to_string())?,
        );
        let response = JString::from(
            env.call_static_method(
                class,
                "request",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(&activity), JValue::Object(&args)],
            )
            .and_then(|v| v.l())
            .map_err(|e| e.to_string())?,
        );
        let text: String = env.get_string(&response).map_err(|e| e.to_string())?.into();
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        if let Some(error) = v["error"].as_str() {
            return Err(error.to_string());
        }
        v.get("data")
            .cloned()
            .ok_or("Extension returned no data".into())
    })();
    if result.is_err() {
        let _ = env.exception_clear();
    }
    result
}
