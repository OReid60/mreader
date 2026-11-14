package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** Real APK smoke test. Network-dependent; runs only on the dedicated emulator. */
class ExtensionHostTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private fun request(args: JSONObject): Any {
        val result=JSONObject(ExtensionHost.request(context,args.toString()))
        assertFalse(result.optString("error"),result.has("error"))
        return result.get("data")
    }
    private fun install(pkg: String, version: Long, url: String) {
        val file=File(context.filesDir,"$pkg.apk")
        file.setWritable(true)
        InstrumentationRegistry.getInstrumentation().context.assets.open("$pkg.apk").use { input -> file.outputStream().use {input.copyTo(it)} }
        val result=request(JSONObject().put("operation","install").put("path",file.absolutePath).put("package",pkg).put("versionCode",version).put("signingKey","9add655a78e96c4ec7a53ef89dccb557cb5d767489fac5e785d671a5a75d4da2")) as org.json.JSONArray
        assertTrue(result.length()>0)
    }
    @Test fun realSignedSourcesSearchChaptersAndPageImage() {
        install("eu.kanade.tachiyomi.extension.all.mangadex",106004,"[user-supplied repository URL]")
        val md=request(JSONObject().put("operation","search").put("sourceId","2499283573021220255").put("query","Kagurabachi").put("page",1)) as JSONObject
        assertTrue(md.getJSONArray("mangas").toString().contains("Kagurabachi"))
        install("eu.kanade.tachiyomi.extension.all.mangaplus",106068,"[user-supplied repository URL]")
        val source="1998944621602463790"
        val search=request(JSONObject().put("operation","search").put("sourceId",source).put("query","Kagurabachi").put("page",1)) as JSONObject
        val manga=search.getJSONArray("mangas").getJSONObject(0)
        val chapters=request(JSONObject().put("operation","chapters").put("sourceId",source).put("url",manga.getString("url")).put("title",manga.getString("title"))) as JSONObject
        val rows=chapters.getJSONArray("chapters");assertTrue(rows.length()>0)
        val chapter=rows.getJSONObject(0)
        val pages=request(JSONObject().put("operation","pages").put("sourceId",source).put("url",chapter.getString("url")).put("title",chapter.getString("title"))) as org.json.JSONArray
        assertTrue(pages.length()>0)
        val image=request(JSONObject().put("operation","image").put("sourceId",source).put("page",pages.getJSONObject(0))) as JSONObject
        assertTrue(File(image.getString("path")).length()>1000)
        // A catalog cannot silently replace an APK with a differently signed binary.
        val bad=JSONObject(ExtensionHost.request(context,JSONObject().put("operation","load").put("path",File(context.filesDir,"eu.kanade.tachiyomi.extension.all.mangadex.apk").absolutePath).put("package","eu.kanade.tachiyomi.extension.all.mangadex").put("versionCode",106004).put("signingKey","0".repeat(64)).toString()))
        assertTrue(bad.optString("error").contains("signer"))
    }
}
