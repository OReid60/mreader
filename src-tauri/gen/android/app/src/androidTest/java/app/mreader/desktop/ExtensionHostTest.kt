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
    @Test fun rustBridgeRepositorySearchReadingAndProgress() {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val intent=android.content.Intent(context,MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity=instrumentation.startActivitySync(intent)
        fun findWebView(view: android.view.View): android.webkit.WebView? {
            if(view is android.webkit.WebView)return view
            if(view is android.view.ViewGroup)for(i in 0 until view.childCount)findWebView(view.getChildAt(i))?.let{return it}
            return null
        }
        var web: android.webkit.WebView?=null
        repeat(100) {if(web==null){instrumentation.runOnMainSync{web=findWebView(activity.window.decorView)};Thread.sleep(100)}}
        val webview=web ?: error("Native reader WebView did not start")
        fun js(script:String):String {
            val result=java.util.concurrent.ArrayBlockingQueue<String>(1)
            instrumentation.runOnMainSync{webview.evaluateJavascript(script){result.offer(it)}}
            return result.poll(10,java.util.concurrent.TimeUnit.SECONDS) ?: error("Reader JavaScript timed out")
        }
        for(i in 0 until 100){if(js("typeof api === 'function' && typeof featureState !== 'undefined'")=="true")break;Thread.sleep(100)}
        fun invoke(command:String,args:JSONObject=JSONObject()):Any {
            val key="nativeTest"+java.util.UUID.randomUUID().toString().replace("-","")
            js("(async()=>{try{const x=await api(${JSONObject.quote(command)},$args);window.$key=JSON.stringify({ok:true,value:x instanceof ArrayBuffer ? {byteLength:x.byteLength}:x});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)});}})();")
            repeat(300){
                val value=js("window.$key || ''")
                val decoded=org.json.JSONTokener(value).nextValue()
                if(decoded is String && decoded.isNotEmpty()){
                    val result=JSONObject(decoded);assertTrue(result.optString("error"),result.getBoolean("ok"));return result.opt("value") ?: JSONObject.NULL
                }
                Thread.sleep(500)
            }
            error("Native command $command timed out")
        }
        val repo="[user-supplied repository URL]"
        invoke("apk_repository",JSONObject().put("url",repo).put("trustKey",JSONObject.NULL))
        invoke("apk_install",JSONObject().put("repository",repo).put("package","eu.kanade.tachiyomi.extension.all.mangaplus"))
        val results=invoke("search_source",JSONObject().put("source","apk:1998944621602463790").put("query","Kagurabachi").put("offset",1)) as JSONObject
        val book=results.getJSONArray("books").getJSONObject(0);val id=book.getString("id")
        assertEquals("apk:1998944621602463790:94cd53e0e69b60b15d7d424defce3955a93dd295571b84e40302b3029e6b1cc6",id)
        invoke("add_book",JSONObject().put("book",book))
        val details=invoke("chapters",JSONObject().put("bookId",id).put("refresh",true)) as JSONObject
        val chapter=details.getJSONArray("chapters").getJSONObject(0).getString("id")
        val meta=invoke("open_chapter",JSONObject().put("bookId",id).put("chapterId",chapter)) as JSONObject
        assertTrue(meta.getInt("pages")>=8)
        val page=invoke("page_data",JSONObject().put("bookId",id).put("chapterId",chapter).put("page",0)) as JSONObject
        assertTrue(page.getInt("byteLength")>1000)
        invoke("save_progress",JSONObject().put("bookId",id).put("chapterId",chapter).put("page",2).put("completed",false).put("totalPages",JSONObject.NULL))
        val snapshot=invoke("snapshot") as JSONObject
        val progress=snapshot.getJSONArray("progress")
        val saved=(0 until progress.length()).map {progress.getJSONObject(it)}.first {it.getString("bookId")==id && it.getString("chapterId")==chapter}
        assertEquals(2,saved.getInt("page"))
        assertTrue(snapshot.getJSONArray("books").getJSONObject(0).getJSONArray("chapters").getJSONObject(0).getInt("pages")>=8)
        invoke("remove_book",JSONObject().put("bookId",id))
        instrumentation.runOnMainSync{activity.finish()}
    }
}
