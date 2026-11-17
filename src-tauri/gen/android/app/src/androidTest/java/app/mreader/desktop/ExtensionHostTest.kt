package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Opt-in source smoke test. Test authors provide their own signed APK and metadata. */
class ExtensionHostTest {
    @Test fun userSuppliedSourceSearchChaptersAndPageImage() {
        val encoded=InstrumentationRegistry.getArguments().getString("sourceFixture")
        assumeTrue("Supply an independently verified source fixture",!encoded.isNullOrBlank())
        val fixture=JSONObject(String(android.util.Base64.decode(encoded,android.util.Base64.DEFAULT),Charsets.UTF_8))
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        fun request(args:JSONObject):Any {
            val result=JSONObject(ExtensionHost.request(context,args.toString()))
            assertFalse(result.optString("error"),result.has("error"));return result.get("data")
        }
        val file=File(context.filesDir,"user-source.apk");file.setWritable(true)
        instrumentation.context.assets.open("user-source.apk").use { input -> file.outputStream().use {input.copyTo(it)} }
        val pkg=fixture.getString("package");val version=fixture.getLong("versionCode");val key=fixture.getString("signingKey")
        val installed=request(JSONObject().put("operation","install").put("path",file.absolutePath).put("package",pkg).put("versionCode",version).put("signingKey",key)) as org.json.JSONArray
        assertTrue(installed.length()>0)
        val source=fixture.getString("sourceId")
        val results=request(JSONObject().put("operation","search").put("sourceId",source).put("query",fixture.getString("query")).put("page",1)) as JSONObject
        val manga=results.getJSONArray("mangas").getJSONObject(0)
        val chapters=request(JSONObject().put("operation","chapters").put("sourceId",source).put("url",manga.getString("url")).put("title",manga.getString("title"))) as JSONObject
        val chapter=chapters.getJSONArray("chapters").getJSONObject(0)
        val pages=request(JSONObject().put("operation","pages").put("sourceId",source).put("url",chapter.getString("url")).put("title",chapter.getString("title"))) as org.json.JSONArray
        assertTrue(pages.length()>0)
        val image=request(JSONObject().put("operation","image").put("sourceId",source).put("page",pages.getJSONObject(0))) as JSONObject
        assertTrue(File(image.getString("path")).length()>1000)
        val wrongKey=if(key=="0".repeat(64)) "1".repeat(64) else "0".repeat(64)
        val bad=JSONObject(ExtensionHost.request(context,JSONObject().put("operation","load").put("path",file.absolutePath).put("package",pkg).put("versionCode",version).put("signingKey",wrongKey).toString()))
        assertTrue(bad.optString("error").contains("signer"))
    }
}
