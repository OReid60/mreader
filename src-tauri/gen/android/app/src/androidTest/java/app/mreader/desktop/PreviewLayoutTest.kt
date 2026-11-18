package app.mreader.desktop
import android.app.Dialog
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import java.io.File
class PreviewLayoutTest {
 @Test fun coverLayoutAndNativeVerificationPreserveProgress(){CoverSyncTest().withReader {js,_ ->
  val ins=InstrumentationRegistry.getInstrumentation()
  lateinit var activity:android.app.Activity
  ins.runOnMainSync{activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).firstOrNull{it is MainActivity}?:error("Reader activity missing")}
  var browserClose:android.widget.Button?=null
  val rotation=activity.windowManager.defaultDisplay.rotation
  val automatic=android.provider.Settings.System.getInt(activity.contentResolver,android.provider.Settings.System.ACCELEROMETER_ROTATION,0)==1
  ins.runOnMainSync{activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
  fun await(key:String):JSONObject {for(i in 0 until 300){val value=JSONTokener(js("window.$key||''")).nextValue();if(value is String&&value.isNotEmpty()){val o=JSONObject(value);assertTrue(o.optString("error"),o.optBoolean("ok"));return o};Thread.sleep(100)};error("Timed out: $key")}
  fun shot(name:String){Thread.sleep(300);val b=ins.uiAutomation.takeScreenshot()?:error("Screenshot failed");File(ins.targetContext.getExternalFilesDir(null)?:ins.targetContext.cacheDir,name).outputStream().use{b.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};b.recycle()}
  fun layout(name:String):JSONObject {val key="layout"+System.nanoTime();js("""window.$key=null;(async()=>{try{const root=document.querySelector('#detail .modal'),c=document.querySelector('#detail .detail-cover>.cover'),s=document.querySelector('#detail .manga-source-info'),buttons=[...document.querySelectorAll('#detail .detail-actions button')].map(b=>b.dataset.action),r=root.getBoundingClientRect(),cr=c.getBoundingClientRect(),sr=s.getBoundingClientRect(),search=document.querySelector('#detail .detail-cover>[data-action=search-cover-images]');const result={ok:true,width:innerWidth,height:innerHeight,noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth,modalFits:r.top>=0&&r.bottom<=innerHeight+1,sourceBelowCover:sr.top>=cr.bottom,searchBelowCover:!search||search.getBoundingClientRect().top>=cr.bottom,startReadingFirst:buttons[0]==='resume',downloadAfterFavorite:buttons[buttons.indexOf('favorite')+1]==='manga-download-info',trashIcon:!!document.querySelector('#detail [data-action=remove] svg')&&!document.querySelector('#detail [data-action=remove]').textContent.trim(),coverHintHidden:!document.querySelector('#detail .cover-art-help'),actions:buttons};window.$key=JSON.stringify(result);}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)})}})()""");val o=await(key);for(k in listOf("noHorizontalOverflow","modalFits","sourceBelowCover","searchBelowCover","startReadingFirst","downloadAfterFavorite","trashIcon","coverHintHidden"))assertTrue("$name: $k",o.getBoolean(k));return o}
  try {
   val key="previewStart"+System.nanoTime()
   js("""window.$key=null;(async()=>{try{window.previewProgressBefore=JSON.stringify((await api('snapshot')).progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());const candidates=state.books.filter(b=>b.source.startsWith('apk:')&&mangaExtensionInfo(b).installed&&b.chapters.some(c=>c.downloaded));let selected;for(const b of candidates.slice(0,6)){try{if(!coverCache.has(b.id)){const bytes=await Promise.race([api('cover_data',{book:b}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Cover timeout')),12000))]);coverCache.set(b.id,URL.createObjectURL(new Blob([bytes])));}selected=b;break;}catch{}}if(!selected)throw Error('No downloaded manga with a usable cover and installed APK source');window.previewTestBook=selected.id;state.detail=selected;renderDetails();window.$key=JSON.stringify({ok:true});}catch(e){window.$key=JSON.stringify({ok:false,error:String(e)})}})()""");await(key)
   Thread.sleep(500)
   val portrait=layout("portrait");shot("preview-portrait.png")
   val gallery="previewGallery"+System.nanoTime()
   js("""window.$gallery=null;(async()=>{try{document.querySelector('#detail [data-action=enlarge-cover]').click();const deadline=Date.now()+8000;while(!document.querySelector('#cover-enlargement img')?.naturalWidth){if(Date.now()>deadline)throw Error('Enlarged image did not decode');await new Promise(r=>setTimeout(r,50));}window.$gallery=JSON.stringify({ok:true,noFilePicker:!document.querySelector('#custom-cover-file')});}catch(e){window.$gallery=JSON.stringify({ok:false,error:String(e)})}})()""");assertTrue(await(gallery).getBoolean("noFilePicker"));shot("preview-enlarged.png")
   assertEquals("true",js("handleAppBack();!document.querySelector('#cover-enlargement')&&state.detail?.id===window.previewTestBook"))
   ins.uiAutomation.setRotation(1);Thread.sleep(1000)
   val landscape=layout("landscape");shot("preview-landscape.png")
   ins.uiAutomation.setRotation(rotation);Thread.sleep(700)
   js("document.querySelector('#detail [data-action=source-verify]').click()")
   var browserRoot:View?=null;var web:WebView?=null
   fun find(v:View):WebView?{if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)find(v.getChildAt(i))?.let{return it};return null}
   fun closeButton(v:View):android.widget.Button?{if(v is android.widget.Button&&v.text.toString()=="Return to Mreader")return v;if(v is ViewGroup)for(i in 0 until v.childCount)closeButton(v.getChildAt(i))?.let{return it};return null}
   for(i in 0 until 300){ins.runOnMainSync{browserRoot=android.view.inspector.WindowInspector.getGlobalWindowViews().firstOrNull{it!==activity.window.decorView&&it.isShown&&closeButton(it)!=null};web=browserRoot?.let{find(it)};browserClose=browserRoot?.let{closeButton(it)}};if(browserRoot!=null&&web!=null)break;Thread.sleep(100)}
   assertTrue("Native source website browser did not open",browserRoot!=null&&web!=null)
   Thread.sleep(1200);var origin="";ins.runOnMainSync{origin=web?.url?:""}
   assertEquals("https",android.net.Uri.parse(origin).scheme)
   var safeHeader=false;ins.runOnMainSync{val insets=browserRoot!!.rootWindowInsets;val top=insets?.getInsets(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.displayCutout())?.top?:0;val rect=android.graphics.Rect();browserClose!!.getGlobalVisibleRect(rect);safeHeader=rect.top>=top}
   assertTrue("Source browser Return button overlaps the status bar",safeHeader);shot("preview-source-browser.png")
   ins.runOnMainSync{browserClose?.performClick()};Thread.sleep(300)
   js("document.querySelector('#detail [data-action=source-verify-cancel]')?.click()")
   val done="previewDone"+System.nanoTime();js("""window.$done=null;(async()=>{try{const after=JSON.stringify((await api('snapshot')).progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());window.$done=JSON.stringify({ok:true,progressUnchanged:after===window.previewProgressBefore,browserSessionClosed:!featureState.sourceVerification});}catch(e){window.$done=JSON.stringify({ok:false,error:String(e)})}})()""")
   val result=await(done);assertTrue("Reading progress changed",result.getBoolean("progressUnchanged"));assertTrue(result.getBoolean("browserSessionClosed"))
   ins.sendStatus(0,Bundle().apply{putString("previewLayoutProof",JSONObject().put("portrait",portrait).put("landscape",landscape).put("coverEnlarged",true).put("nativeBrowserOpened",true).put("browserHeaderSafe",true).put("progressUnchanged",true).toString())})
  }finally{ins.uiAutomation.setRotation(if(automatic)-2 else rotation);ins.runOnMainSync{activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);if(browserClose?.isShown==true)browserClose?.performClick()}}
 }}
}
