package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import android.database.sqlite.SQLiteDatabase

/** Opt-in on a paired device: downloads one existing chapter; never changes read progress. */
class BackgroundDownloadTest {
 @Test fun downloadsCompleteWithScreenOff() {
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val context=instrumentation.targetContext
  val activity=instrumentation.startActivitySync(android.content.Intent(context,MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
  fun find(v:View):WebView? {if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
  var web:WebView?=null
  repeat(100){if(web==null){instrumentation.runOnMainSync{web=find(activity.window.decorView)};Thread.sleep(100)}}
  val w=web?:error("Mreader WebView unavailable")
  fun js(script:String):String {val q=java.util.concurrent.ArrayBlockingQueue<String>(1);instrumentation.runOnMainSync{w.evaluateJavascript(script){q.offer(it)}};return q.poll(10,java.util.concurrent.TimeUnit.SECONDS)?:error("JS timeout")}
  repeat(100){if(js("typeof state!=='undefined' && !!state.dataDir")=="true")return@repeat;Thread.sleep(100)}
  js("window.backgroundTest=null;(async()=>{try{const s=await api('snapshot');const b=s.books.find(b=>b.source.startsWith('apk:')&&b.chapters.some(c=>!c.downloaded));if(!b)throw Error('No chapter available for the screen-off test');const c=b.chapters.find(c=>!c.downloaded);await api('download_enqueue',{bookId:b.id,chapterIds:[c.id],unreadOnly:false});window.backgroundTest=JSON.stringify({book:b.id,chapter:c.id});}catch(e){window.backgroundTest=JSON.stringify({error:String(e)});}})();")
  var selected:JSONObject?=null
  repeat(100){if(selected==null){val value=org.json.JSONTokener(js("window.backgroundTest||''")).nextValue();if(value is String&&value.isNotEmpty())selected=JSONObject(value)else Thread.sleep(200)}}
  val chosen=selected?:error("Queue did not start");assertFalse(chosen.optString("error"),chosen.has("error"))
  val book=chosen.getString("book")
  val databases=context.dataDir.walkTopDown().filter{it.isFile&&it.name=="library.sqlite"}.toList()
  assertTrue("Library database missing",databases.isNotEmpty())
  fun job():JSONObject? {
   for(file in databases){val db=SQLiteDatabase.openDatabase(file.absolutePath,null,SQLiteDatabase.OPEN_READONLY);try{db.rawQuery("SELECT data FROM download_queue WHERE id=1",null).use{c->if(c.moveToFirst()){val jobs=org.json.JSONArray(c.getString(0));for(i in 0 until jobs.length()){val j=jobs.getJSONObject(i);if(j.getString("id")==book)return j}}}}finally{db.close()}}
   return null
  }
  val before=job()?:error("Queue was not persisted")
  val power=context.getSystemService(android.os.PowerManager::class.java)
  instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
  try{
   Thread.sleep(1500);assertFalse("Phone screen must be off",power.isInteractive)
   var completed=false
   for(i in 0 until 180){val current=job();if(current!=null&&current.getJSONArray("failed").length()>0)error(current.getJSONArray("failed").toString());if((current?.optInt("done",0)?:0)>before.optInt("done",0)){completed=true;break};Thread.sleep(1000)}
   assertTrue("Native download did not finish while the screen was off",completed)
   assertFalse("Screen unexpectedly woke during downloads",power.isInteractive)
  } finally {instrumentation.uiAutomation.executeShellCommand("input keyevent 224").close()}
 }
}
