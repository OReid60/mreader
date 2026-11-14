package eu.kanade.tachiyomi
import app.mreader.desktop.BuildConfig

/** Host information requested by binary source extensions. */
object AppInfo {
    fun getVersionCode(): Int = BuildConfig.VERSION_CODE
    fun getVersionName(): String = BuildConfig.VERSION_NAME
    fun getSupportedImageMimeTypes(): List<String> = listOf("image/jpeg","image/png","image/webp","image/gif","image/bmp")
}
