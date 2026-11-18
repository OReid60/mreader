package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Opt-in paired-device reads only; never enters the reader or writes progress. */
class LonerLifePagesTest {
 @Test fun savedChapterAndPageImagesLoad() {
  assumeTrue("Manual paired-device check",InstrumentationRegistry.getArguments().getString("sourceProbe")=="true")
  CoverSyncTest().withReader { _, invoke ->
   val ins=InstrumentationRegistry.getInstrumentation()
   val before=invoke("snapshot",JSONObject()) as JSONObject
   fun request(source:String,operation:String,args:JSONObject):Any {
    args.put("sourceId",source.removePrefix("apk:")).put("operation",operation)
    var result=JSONObject(ExtensionHost.request(ins.targetContext,args.toString()))
    if(result.optString("error").contains("browser verification",true)&&InstrumentationRegistry.getArguments().getString("verify")=="true") {
     val verification=invoke("source_verification_open",JSONObject().put("source",source)) as JSONObject
     Thread.sleep(90000)
     invoke("source_verification_finish",JSONObject().put("id",verification.getString("id")).put("cancel",false))
     result=JSONObject(ExtensionHost.request(ins.targetContext,args.toString()))
    }
    assertFalse(result.optString("error"),result.has("error"))
    return result.get("data")
   }
   try {
    val books=before.getJSONArray("books")
    val book=(0 until books.length()).map{books.getJSONObject(it)}.firstOrNull{
     it.getString("title").equals("Loner Life in Another World",true)&&it.getString("source")=="apk:1024627298672457456"
    }?:error("Requested source/title is not in this library")
    val source=book.getString("source")
    // Production preview initializes the installed source and fetches chapters without saving them.
    val preview=invoke("preview_source_book",JSONObject().put("book",book)) as JSONObject
    assertTrue("Source returned no chapters",preview.getJSONArray("chapters").length()>0)
    val chapters=(request(source,"chapters",JSONObject().put("url",book.getString("remoteId")).put("title",book.getString("title"))) as JSONObject).getJSONArray("chapters")
    assertTrue("Source returned no chapters",chapters.length()>0)
    val chapter=(0 until chapters.length()).map{chapters.getJSONObject(it)}.firstOrNull{it.optString("number").toFloatOrNull()==1f}?:chapters.getJSONObject(chapters.length()-1)
    ins.sendStatus(0,android.os.Bundle().apply{putString("chapterSelected",JSONObject().put("chapters",chapters.length()).put("chapter",chapter).toString())})
    if(InstrumentationRegistry.getArguments().getString("diagnostic")=="true") {
     val field=ExtensionHost::class.java.getDeclaredField("sources");field.isAccessible=true
     val sourceMap=field.get(null) as java.util.concurrent.ConcurrentHashMap<*,*>
     val http=sourceMap[source.removePrefix("apk:")] as eu.kanade.tachiyomi.source.online.HttpSource
     val c=eu.kanade.tachiyomi.source.model.SChapter.create().apply{url=chapter.getString("url");name=chapter.optString("title")}
     http.client.newCall(okhttp3.Request.Builder().url(http.getChapterUrl(c)).headers(http.headers).build()).execute().use{response->
      val text=response.body.string();val dom=org.jsoup.Jsoup.parse(text,response.request.url.toString())
      ins.sendStatus(0,android.os.Bundle().apply{putString("pageStructure",JSONObject().put("status",response.code).put("url",response.request.url.toString()).put("title",dom.title()).put("images",dom.select("img").size).put("imageStructure",org.json.JSONArray(dom.select("img").take(8).map{img->JSONObject().put("attributes",img.attributes().asList().map{it.key}).put("src",img.attr("src").take(160)).put("ancestors",img.parents().take(3).map{it.tagName()+"#"+it.id()+"."+it.className()})})).put("readerImages",dom.select("div.container-chapter-reader > img").size).put("scriptsWithImages",dom.select("script").count{it.data().contains("chapterImages")}).put("readerContainers",dom.select("[id*=reader], [class*=reader], [class*=reading]").map{it.tagName()+"#"+it.id()+"."+it.className()}.take(12)).toString())})
     }
    }
    val pages=request(source,"pages",JSONObject().put("url",chapter.getString("url")).put("title",chapter.optString("title")).put("memo",chapter.optJSONObject("memo")?:JSONObject()).put("mangaUrl",book.getString("remoteId")).put("mangaTitle",book.getString("title"))) as org.json.JSONArray
    assertTrue("Source returned no pages",pages.length()>0)
    var decoded=0
    for(i in 0 until minOf(2,pages.length())) {
     val image=request(source,"image",JSONObject().put("page",pages.getJSONObject(i))) as JSONObject
     val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
     android.graphics.BitmapFactory.decodeFile(image.getString("path"),bounds)
     assertTrue("Page image did not decode",bounds.outWidth>0&&bounds.outHeight>0)
     decoded++
    }
    ins.sendStatus(0,android.os.Bundle().apply{putString("lonerLifePages",JSONObject().put("chapters",chapters.length()).put("pages",pages.length()).put("decodedImages",decoded).toString())})
   } finally {
    val after=invoke("snapshot",JSONObject()) as JSONObject
    assertEquals("Reading progress changed",before.getJSONArray("progress").toString(),after.getJSONArray("progress").toString())
    ins.sendStatus(0,android.os.Bundle().apply{putString("progressUnchanged","true")})
   }
  }
 }
}
