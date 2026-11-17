package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import android.database.sqlite.SQLiteDatabase
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.io.File
import android.os.Bundle

/** Read-only inspection of the active profile and completed offline files. */
class OfflineDownloadTest {
 private fun progress(snapshot:JSONObject):String {
  val rows=snapshot.getJSONArray("progress");return (0 until rows.length()).map{rows.getJSONObject(it)}.sortedBy{it.getString("bookId")+"\u0000"+it.getString("chapterId")}.joinToString("|"){org.json.JSONArray().put(it.getString("bookId")).put(it.getString("chapterId")).put(it.getInt("page")).put(it.getBoolean("completed")).put(it.getLong("updated")).toString()}
 }
 @Test fun prepareMangaReadDownloadWithoutChangingProgress(){
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  CoverSyncTest().withReader {_,invoke ->
   val before=invoke("snapshot",JSONObject()) as JSONObject;val books=before.getJSONArray("books")
   val book=(0 until books.length()).map{books.getJSONObject(it)}.first{it.getString("title").contains("Kagurabachi",true)&&it.getString("source")=="apk:2681651342533848540"};val id=book.getString("id")
   val refreshed=invoke("chapters",JSONObject().put("bookId",id).put("refresh",true)) as JSONObject
   val chapters=refreshed.getJSONArray("chapters");val chapter=(0 until chapters.length()).map{chapters.getJSONObject(it)}.first{it.optString("number").toDoubleOrNull()==1.0}
   assertTrue("MangaRead chapter context was not persisted",chapter.getJSONObject("sourceMemo").has("mangaPath"))
   if(!chapter.optBoolean("downloaded"))invoke("download_enqueue",JSONObject().put("bookId",id).put("chapterIds",JSONArray().put(chapter.getString("id"))).put("unreadOnly",false))
   var saved:JSONObject?=null
   for(n in 0 until 180){
    val snapshot=invoke("snapshot",JSONObject()) as JSONObject;val bs=snapshot.getJSONArray("books");val b=(0 until bs.length()).map{bs.getJSONObject(it)}.first{it.getString("id")==id};val cs=b.getJSONArray("chapters");val c=(0 until cs.length()).map{cs.getJSONObject(it)}.first{it.getString("id")==chapter.getString("id")}
    if(c.optBoolean("downloaded")){saved=c;assertEquals("Reading progress changed during download",progress(before),progress(snapshot));break}
    val jobs=invoke("download_queue",JSONObject()) as JSONArray;val job=(0 until jobs.length()).map{jobs.getJSONObject(it)}.firstOrNull{it.getString("id")==id}
    if(job!=null&&job.getJSONArray("failed").length()>0)error(job.getJSONArray("failed").getJSONObject(0).getString("error"));Thread.sleep(1000)
   }
   val c=saved?:error("MangaRead download did not complete");assertTrue(File(c.getString("path")).isDirectory);assertTrue(c.getInt("pages")>0)
   File(instrumentation.targetContext.cacheDir,"mreader-offline-test.json").writeText(JSONObject().put("bookId",id).put("chapterId",c.getString("id")).put("progress",progress(before)).toString())
   instrumentation.sendStatus(0,Bundle().apply{putString("downloadProof",JSONObject().put("pages",c.getInt("pages")).put("number",c.getString("number")).put("memoSaved",true).put("progressUnchanged",true).toString())})
  }
 }
 @Test fun readWithWifiAndMobileDataOffThenRestore(){
  val i=InstrumentationRegistry.getInstrumentation();val chosen=JSONObject(File(i.targetContext.cacheDir,"mreader-offline-test.json").readText())
  fun shell(command:String)=android.os.ParcelFileDescriptor.AutoCloseInputStream(i.uiAutomation.executeShellCommand(command)).bufferedReader().use{it.readText().trim()}
  val subscription=android.telephony.SubscriptionManager.getDefaultDataSubscriptionId()
  val subscriptionKey="mobile_data"+subscription
  val dataKey=if(shell("settings get global "+subscriptionKey)=="null")"mobile_data" else subscriptionKey
  val wifi=shell("settings get global wifi_on")!="0";val data=shell("settings get global "+dataKey)=="1"
  val restore="svc wifi "+(if(wifi)"enable" else "disable")+"; svc data "+(if(data)"enable" else "disable")
  val report=JSONObject().put("passed",false)
  CoverSyncTest().withReader {js,invoke ->
   // Independent shell watchdog restores the original radios even if the app exits.
   val pipes=i.uiAutomation.executeShellCommandRw("sh")
   android.os.ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use{it.write("(sleep 25; $restore) >/dev/null 2>&1 &\nexit\n".toByteArray())}
   pipes[0].close()
   try{
    shell("svc data disable");shell("svc wifi disable");Thread.sleep(2500)
    val wifiOff=shell("cmd wifi status").lineSequence().firstOrNull()?.contains("disabled",true)==true
    report.put("wifiOff",wifiOff).put("mobileDataSetting",shell("settings get global "+dataKey))
    assertTrue("Wi-Fi radio is still enabled",wifiOff);assertEquals("0",shell("settings get global "+dataKey))
    val args=JSONObject().put("bookId",chosen.getString("bookId")).put("chapterId",chosen.getString("chapterId"))
    val meta=invoke("open_chapter",args) as JSONObject;val pages=meta.getInt("pages");assertTrue(pages>0)
    val key="offlineProof"+System.nanoTime()
    js("window.$key=null;(async()=>{try{let checked=0;for(const page of [0,${pages-1}]){const bytes=await api('page_data',{...$args,page});const image=await createImageBitmap(new Blob([bytes]));if(!image.width)throw Error('Empty offline image');image.close();checked++;}window.$key=JSON.stringify({ok:true,checked});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)});}})();")
    var result:JSONObject?=null;for(n in 0 until 100){val value=org.json.JSONTokener(js("window.$key||''")).nextValue();if(value is String&&value.isNotEmpty()){result=JSONObject(value);break};Thread.sleep(100)}
    val read=result?:error("Offline page read timed out");assertTrue(read.optString("error"),read.getBoolean("ok"));assertEquals(2,read.getInt("checked"))
    assertTrue("Wi-Fi restored before page verification",shell("cmd wifi status").lineSequence().firstOrNull()?.contains("disabled",true)==true)
    assertEquals("0",shell("settings get global "+dataKey))
    assertEquals(chosen.getString("progress"),progress(invoke("snapshot",JSONObject()) as JSONObject))
    report.put("passed",true).put("pages",pages).put("firstAndLastPageDecoded",true).put("wifiOff",true).put("mobileDataOff",true).put("progressUnchanged",true)
   }catch(error:Throwable){report.put("error",error.toString().take(250));throw error}
   finally{shell("svc wifi "+if(wifi)"enable" else "disable");shell("svc data "+if(data)"enable" else "disable");report.put("wifiRestored",(shell("settings get global wifi_on")!="0")==wifi).put("mobileDataRestored",(shell("settings get global "+dataKey)=="1")==data);android.util.Log.i("MreaderOfflineTest","OFFLINE_PROOF "+report.toString());i.sendStatus(0,Bundle().apply{putString("offlineProof",report.toString())})}
  }
 }
 @Test fun auditSavedDownloads() {
  val i=InstrumentationRegistry.getInstrumentation();val context=i.targetContext
  val config=context.dataDir.walkTopDown().first{it.isFile&&it.name=="cloud-config.json"};val cfg=JSONObject(config.readText());val root=config.parentFile!!
  val profile=if(cfg.isNull("activeUser"))root else File(root,"profiles/"+cfg.getString("activeUser"))
  val db=SQLiteDatabase.openDatabase(File(profile,"library.sqlite").absolutePath,null,SQLiteDatabase.OPEN_READONLY)
  val rows=JSONArray();var downloaded=0;var missing=0;var unknown=0
  try{db.rawQuery("SELECT data FROM books",null).use{cursor->while(cursor.moveToNext()){
   val book=JSONObject(cursor.getString(0));val chapters=book.getJSONArray("chapters");val isKagurabachi=book.getString("title").contains("Kagurabachi",true)
   val details=JSONArray();var bookDownloads=0
   for(n in 0 until chapters.length()){
    val c=chapters.getJSONObject(n);val saved=c.optBoolean("downloaded");if(c.optString("number")=="-1")unknown++
    if(saved){downloaded++;bookDownloads++;val file=File(c.optString("path"));val count=if(file.isDirectory)file.listFiles()?.count{it.isFile&&it.extension.lowercase() in setOf("jpg","jpeg","png","webp","gif")}?:0 else 0;if(!file.exists())missing++
     details.put(JSONObject().put("id",c.getString("id")).put("title",c.getString("title")).put("number",c.optString("number")).put("pages",c.optInt("pages")).put("exists",file.exists()).put("files",count))
    }
   }
   if(isKagurabachi||bookDownloads>0)rows.put(JSONObject().put("id",book.getString("id")).put("title",book.getString("title")).put("source",book.getString("source")).put("chapters",chapters.length()).put("downloaded",bookDownloads).put("downloads",details))
  }}
   val jobs=try{db.rawQuery("SELECT data FROM download_queue WHERE id=1",null).use{if(it.moveToFirst())JSONArray(it.getString(0))else JSONArray()}}catch(_:Exception){JSONArray()}
   val result=JSONObject().put("books",rows).put("downloadedChapters",downloaded).put("missingPaths",missing).put("unknownNumbers",unknown).put("jobs",jobs)
   i.sendStatus(0,Bundle().apply{putString("downloadAuditJson",result.toString())})
   if(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("cleanup")=="true")File(context.cacheDir,"mreader-offline-test.json").delete()
  }finally{db.close()}
 }
}
