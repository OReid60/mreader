package app.mreader.desktop
import androidx.test.platform.app.InstrumentationRegistry
import android.os.Bundle
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
class CoverTapTest {
 @Test fun googleSearchUsesMangaTitle(){CoverSyncTest().withReader {js,_ ->
  val instrumentation=InstrumentationRegistry.getInstrumentation()
  val captured=java.util.concurrent.atomic.AtomicReference<android.content.Intent>()
  val monitor=object:android.app.Instrumentation.ActivityMonitor(){
   override fun onStartActivity(intent:android.content.Intent):android.app.Instrumentation.ActivityResult? {
    if(intent.action==android.content.Intent.ACTION_VIEW&&intent.data?.host=="www.google.com"){
     captured.set(intent);return android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null)
    };return null
   }
  }
  instrumentation.addMonitor(monitor)
  try {
   js("window.MreaderChrome.searchCoverImages('Mreader title & cover test')")
   for(i in 0 until 100){if(captured.get()!=null)break;Thread.sleep(50)}
   val uri=captured.get()?.data?:error("Google Images browser intent missing")
   assertEquals("https",uri.scheme);assertEquals("isch",uri.getQueryParameter("tbm"))
   assertEquals("Mreader title & cover test manga cover",uri.getQueryParameter("q"))
   instrumentation.sendStatus(0,Bundle().apply{putString("coverSearchProof","Google Images intent and encoded manga title verified; browser launch intercepted")})
  }finally{instrumentation.removeMonitor(monitor)}
 }}
 @Test fun missingLibraryCoverOpensPreviewOnly(){CoverSyncTest().withReader {js,invoke ->
  val key="coverTapProof"+System.nanoTime()
  js("""window.$key=null;(async()=>{let originalClick;try{const before=await api('snapshot');await navigate('Library');const placeholder=document.querySelector('.grid .cover-placeholder');const card=placeholder?.closest('.card');if(!card)throw Error('No visible missing-cover card to test');let pickerOpened=0;originalClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){pickerOpened++;return;}return originalClick.call(this)};const cover=card.querySelector('.cover-placeholder');if(!cover)throw Error('Missing-cover placeholder not found');cover.click();const deadline=Date.now()+15000;while(!document.querySelector('#detail .detail-cover')){if(Date.now()>deadline)throw Error('Preview did not open');await new Promise(r=>setTimeout(r,50))}const libraryDidNotUpload=pickerOpened===0;document.querySelector('#detail .detail-cover [data-action=choose-custom-cover]').click();await new Promise(r=>setTimeout(r,100));const previewOffersUpload=pickerOpened===1;const search=document.querySelector('#detail [data-action=search-cover-images]');let searchDialogAvailable=null;if(search){search.click();searchDialogAvailable=!!document.querySelector('#cover-image-search [data-action=cover-image-select]');document.querySelector('#cover-image-search [data-action=cover-search-close]').click();}HTMLInputElement.prototype.click=originalClick;document.querySelector('#custom-cover-file')?.remove();closeDetail();const after=await api('snapshot');const canon=s=>JSON.stringify(s.progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());window.$key=JSON.stringify({ok:true,libraryOpensPreview:libraryDidNotUpload,previewOffersUpload,searchDialogAvailable,progressUnchanged:canon(before)===canon(after)});}catch(e){if(originalClick)HTMLInputElement.prototype.click=originalClick;window.$key=JSON.stringify({ok:false,error:String(e)})}})();""")
  var result:JSONObject?=null
  for(n in 0 until 200){val value=JSONTokener(js("window.$key||''")).nextValue();if(value is String&&value.isNotEmpty()){result=JSONObject(value);break};Thread.sleep(100)}
  val proof=result?:error("Cover tap test timed out");assertTrue(proof.optString("error"),proof.getBoolean("ok"));for(name in listOf("libraryOpensPreview","previewOffersUpload","progressUnchanged"))assertTrue(name,proof.getBoolean(name))
  InstrumentationRegistry.getInstrumentation().sendStatus(0,Bundle().apply{putString("coverTapProof",proof.toString())})
 }}
}
