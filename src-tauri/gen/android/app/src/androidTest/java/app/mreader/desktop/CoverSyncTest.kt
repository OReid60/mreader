package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import android.webkit.WebView
import android.view.View
import android.view.ViewGroup
import android.os.Bundle
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import okio.Buffer
import okio.buffer
import java.security.MessageDigest

/** Explicit paired-device checks: only a newly-created, empty test manga is edited. */
class CoverSyncTest {
 private val instrumentation=InstrumentationRegistry.getInstrumentation()
 private fun sha(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it.toInt() and 255)}

 @Test fun zstdCompressedResponseDoesNotAbort() {
  val text="Mreader compressed response"
  val data=text.toByteArray();val block=(data.size shl 3) or 1
  val frame=byteArrayOf(0x28,0xb5.toByte(),0x2f,0xfd.toByte(),0x20,data.size.toByte(),block.toByte(),(block shr 8).toByte(),(block shr 16).toByte())+data
  assertEquals(text,okhttp3.zstd.Zstd.decompress(Buffer().write(frame)).buffer().use{it.readUtf8()})
 }

 @Test fun desktopCoverArrivesAndPhoneCoverReturns() {
  val args=InstrumentationRegistry.getArguments();val id=args.getString("bookId")?:error("Missing test identity")
  require(id.matches(Regex("mangadex:[0-9a-f-]{36}")))
  val expected=args.getString("desktopSha")?:error("Missing desktop cover hash")
  require(expected.matches(Regex("[0-9a-f]{64}")))
  withReader {js,invoke ->
   val status=invoke("cloud_status",JSONObject()) as JSONObject;assertTrue("Sign into the same account on both devices",status.getBoolean("signedIn"))
   val received=(invoke("cloud_sync",JSONObject()) as JSONObject).getJSONObject("snapshot")
   fun testBook(snapshot:JSONObject):JSONObject {
    val books=snapshot.getJSONArray("books");val b=(0 until books.length()).map{books.getJSONObject(it)}.firstOrNull{it.getString("id")==id}?:error("Desktop test title did not arrive")
    assertEquals("Mreader cover sync test",b.getString("title"));assertEquals("mangadex",b.getString("source"));assertEquals(0,b.getJSONArray("chapters").length());return b
   }
   val blue=testBook(received).getJSONObject("customCover")
   assertEquals("Desktop cover bytes must arrive unchanged",expected,sha(android.util.Base64.decode(blue.getString("jpeg"),android.util.Base64.DEFAULT)))
   // Invoke raw IPC exactly as the cover picker does; no reading APIs are called.
   val key="coverChange"+System.nanoTime()
   js("window.$key=null;(async()=>{try{const before=await api('snapshot');const c=document.createElement('canvas');c.width=80;c.height=120;const x=c.getContext('2d');x.fillStyle='#28b478';x.fillRect(0,0,80,120);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));await applyCustomCover(${JSONObject.quote(id)},new File([blob],'cover-sync-test.jpg',{type:'image/jpeg'}));const result=await api('cloud_sync');const canonical=s=>JSON.stringify(s.progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());window.$key=JSON.stringify({ok:true,value:result.snapshot,progressUnchanged:canonical(before)===canonical(result.snapshot)});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)});}})();")
   val changed=awaitValue(js,key);assertTrue(changed.optString("error"),changed.getBoolean("ok"));assertTrue("Phone reading progress changed",changed.getBoolean("progressUnchanged"))
   val art=testBook(changed.getJSONObject("value")).getJSONObject("customCover");val bytes=android.util.Base64.decode(art.getString("jpeg"),android.util.Base64.DEFAULT)
   val green=sha(bytes);assertNotEquals(expected,green)
   val bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size)?:error("Synced custom image did not decode")
   val pixel=bitmap.getPixel(0,0);bitmap.recycle();assertTrue(kotlin.math.abs(android.graphics.Color.green(pixel)-180)<10)
   instrumentation.sendStatus(0,Bundle().apply{putString("coverSync",JSONObject().put("desktopReceivedSha256",expected).put("phoneCoverSha256",green).put("progressUnchanged",true).toString())})
  }
 }

 @Test fun removedTestTitleDisappearsAfterSync() {
  val id=InstrumentationRegistry.getArguments().getString("bookId")?:error("Missing test identity")
  require(id.matches(Regex("mangadex:[0-9a-f-]{36}")))
  withReader {_,invoke ->
   val snapshot=(invoke("cloud_sync",JSONObject()) as JSONObject).getJSONObject("snapshot");val books=snapshot.getJSONArray("books")
   assertFalse((0 until books.length()).any{books.getJSONObject(it).getString("id")==id})
   val filename=sha(id.toByteArray())+".jpg"
   // Remove only this test's old local image cache, after its synced deletion.
   instrumentation.targetContext.dataDir.walkTopDown().filter{it.isFile&&it.name==filename&&it.parentFile?.name=="custom-covers"}.forEach{it.delete()}
  }
 }

 internal fun withReader(test:((String)->String,(String,JSONObject)->Any)->Unit) {
  val context=instrumentation.targetContext
  val activity=instrumentation.startActivitySync(android.content.Intent(context,MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
  fun find(v:View):WebView?{if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
  var web:WebView?=null
  for(i in 0 until 100){instrumentation.runOnMainSync{web=find(activity.window.decorView)};if(web!=null)break;Thread.sleep(100)}
  val w=web?:error("Mreader WebView unavailable")
  fun js(script:String):String{val queue=java.util.concurrent.ArrayBlockingQueue<String>(1);instrumentation.runOnMainSync{w.evaluateJavascript(script){queue.offer(it)}};return queue.poll(15,java.util.concurrent.TimeUnit.SECONDS)?:error("WebView timeout")}
  try{
   var ready=false;for(i in 0 until 150){if(js("typeof api==='function' && typeof state!=='undefined' && !!state.dataDir")=="true"){ready=true;break};Thread.sleep(100)};assertTrue("Reader did not finish startup",ready)
   fun invoke(command:String,args:JSONObject):Any{val key="coverCommand"+System.nanoTime();js("window.$key=null;(async()=>{try{const value=await api(${JSONObject.quote(command)},$args);window.awaitSnapshotForCoverTest=value.snapshot||value;window.$key=JSON.stringify({ok:true,value});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)});}})();");val result=awaitValue(::js,key);assertTrue(result.optString("error"),result.getBoolean("ok"));return result.opt("value")?:JSONObject.NULL}
   test(::js,::invoke)
  }finally{instrumentation.runOnMainSync{activity.finish()}}
 }
 private fun awaitValue(js:(String)->String,key:String):JSONObject{
  for(i in 0 until 240){val decoded=JSONTokener(js("window.$key||''")).nextValue();if(decoded is String&&decoded.isNotEmpty())return JSONObject(decoded);Thread.sleep(250)}
  error("Cover command timed out")
 }
}
