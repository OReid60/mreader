#[cfg(not(target_os = "android"))]
pub use keyring::Entry;
#[cfg(target_os = "android")]
pub struct Entry {
    key: String,
}
#[cfg(target_os = "android")]
impl Entry {
    pub fn new(service: &str, user: &str) -> Result<Self, String> {
        Ok(Self {
            key: format!("{service}:{user}"),
        })
    }
    pub fn get_password(&self) -> Result<String, String> {
        self.call("get", None)
    }
    pub fn set_password(&self, value: &str) -> Result<(), String> {
        self.call("set", Some(value)).map(|_| ())
    }
    pub fn delete_credential(&self) -> Result<(), String> {
        self.call("remove", None).map(|_| ())
    }
    fn call(&self, method: &str, value: Option<&str>) -> Result<String, String> {
        use jni::{
            objects::{JClass, JObject, JString, JValue},
            JavaVM,
        };
        let context = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }.map_err(|e| e.to_string())?;
        let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;
        let outcome = (|| {
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
                env.new_string("app.mreader.desktop.Secrets")
                    .map_err(|e| e.to_string())?,
            );
            let class = env
                .call_method(
                    loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[JValue::Object(&name)],
                )
                .and_then(|v| v.l())
                .map_err(|e| e.to_string())?;
            let class = JClass::from(class);
            let key = JObject::from(env.new_string(&self.key).map_err(|e| e.to_string())?);
            let result = if let Some(value) = value {
                let text = JObject::from(env.new_string(value).map_err(|e| e.to_string())?);
                env.call_static_method(
                class,
                method,
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                &[
                    JValue::Object(&activity),
                    JValue::Object(&key),
                    JValue::Object(&text),
                ],
            )
            } else {
                env.call_static_method(
                    class,
                    method,
                    "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::Object(&activity), JValue::Object(&key)],
                )
            }
            .and_then(|v| v.l())
            .map_err(|e| e.to_string())?;
            if result.is_null() {
                return Err("No saved credential".into());
            }
            let result = JString::from(result);
            let text = env.get_string(&result).map_err(|e| e.to_string())?;
            Ok(text.into())
        })();
        if outcome.is_err() {
            // A pending Java exception must not poison later JNI calls on
            // this worker thread after an unavailable Keystore operation.
            let _ = env.exception_clear();
        }
        outcome
    }
}
