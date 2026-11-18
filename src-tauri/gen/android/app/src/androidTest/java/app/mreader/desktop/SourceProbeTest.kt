package app.mreader.desktop
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.CookieManager
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import java.io.File
class SourceProbeTest {
 @Test fun manganatoVerificationDiagnostic(){org.junit.Assume.assumeTrue("Manual paired-device source diagnostic",InstrumentationRegistry.getArguments().getString("sourceProbe")=="true");CoverSyncTest().withReader {js,_ ->
  val ins=InstrumentationRegistry.getInstrumentation();lateinit var activity:android.app.Activity
  ins.runOnMainSync{activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).first{it is MainActivity};activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
  var close:android.widget.Button?=null
  fun status(name:String,value:JSONObject){ins.sendStatus(0,Bundle().apply{putString(name,value.toString())})}
  fun await(key:String):JSONObject{for(i in 0 until 700){val v=JSONTokener(js("window.$key||''")).nextValue();if(v is String&&v.isNotEmpty()){val o=JSONObject(v);assertTrue(o.optString("error"),o.optBoolean("ok"));return o};Thread.sleep(100)};error("Diagnostic timed out")}
  fun remote(web:WebView,code:String):String{val q=java.util.concurrent.ArrayBlockingQueue<String>(1);ins.runOnMainSync{web.evaluateJavascript(code){q.offer(it)}};return q.poll(10,java.util.concurrent.TimeUnit.SECONDS)?:"null"}
  fun screenshot(){Thread.sleep(300);val b=ins.uiAutomation.takeScreenshot()?:return;File(ins.targetContext.getExternalFilesDir(null)?:ins.targetContext.cacheDir,"manganato-browser-probe.png").outputStream().use{b.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};b.recycle()}
  try {
   val start="sourceProbeStart"+System.nanoTime()
   js("""window.$start=null;(async()=>{try{window.sourceProbeBaseline=JSON.stringify((await api('snapshot')).progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());let a=await api('apk_state');const match=a.installed.find(i=>/manganato/i.test(i.extension.name)||i.extension.sources.some(s=>/manganato/i.test(s.name)));if(!match)throw Error('Manganato is not installed on this device');const originalExtension=match.extension;let catalogRefreshed=false;const repository=a.repositories.find(r=>r.catalog.extensions.some(e=>e.package===originalExtension.package));if(repository){try{a=await api('apk_repository',{url:repository.url,trustKey:null});catalogRefreshed=true;}catch{}}const e=originalExtension,s=e.sources.find(s=>s.language==='en'&&/manganato/i.test(s.name))||e.sources.find(s=>s.language==='en')||e.sources[0];window.sourceProbeId='apk:'+s.id;const listed=a.repositories.flatMap(r=>r.catalog.extensions).filter(x=>x.package===e.package).sort((a,b)=>b.versionCode-a.versionCode)[0];window.sourceProbeMetadata={appVersion:await window.__TAURI__.app.getVersion(),catalogRefreshed,sourceId:String(s.id),extension:e.name,installedVersion:e.version,installedVersionCode:e.versionCode,catalogVersion:listed?.version||null,catalogVersionCode:listed?.versionCode||null,sourceName:s.name,language:s.language};window.sourceProbeSearch=async()=>{try{const r=await Promise.race([api('search_source',{source:window.sourceProbeId,query:'',offset:0}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Source request timed out')),35000))]);return{success:true,results:r.books?.length||0}}catch(e){return{success:false,error:String(e).slice(0,1500)}}};window.sourceProbeBefore=await window.sourceProbeSearch();featureState.sourceVerification=await api('source_verification_open',{source:window.sourceProbeId});window.$start=JSON.stringify({ok:true,...window.sourceProbeMetadata,before:window.sourceProbeBefore});}catch(e){window.$start=JSON.stringify({ok:false,error:String(e)})}})()""")
   val first=await(start);status("sourceProbeBefore",first)
   fun findWeb(v:View):WebView?{if(v is WebView)return v;if(v is ViewGroup)for(i in 0 until v.childCount)findWeb(v.getChildAt(i))?.let{return it};return null}
   fun findClose(v:View):android.widget.Button?{if(v is android.widget.Button&&v.text.toString()=="Return to Mreader")return v;if(v is ViewGroup)for(i in 0 until v.childCount)findClose(v.getChildAt(i))?.let{return it};return null}
   var web:WebView?=null
   for(i in 0 until 200){ins.runOnMainSync{val root=android.view.inspector.WindowInspector.getGlobalWindowViews().firstOrNull{it.isShown&&findClose(it)!=null};close=root?.let{findClose(it)};web=root?.let{findWeb(it)}};if(web!=null)break;Thread.sleep(100)}
   val browser=web?:error("Native verification browser did not appear");Thread.sleep(1800)
   var url="";var ua="";var systemUa="";var title=""
   ins.runOnMainSync{url=browser.url?:"";ua=browser.settings.userAgentString;systemUa=android.webkit.WebSettings.getDefaultUserAgent(activity);title=browser.title?:""}
   fun clearance():Boolean {ins.runOnMainSync{url=browser.url?:url};return CookieManager.getInstance().getCookie(url)?.split(';')?.any{it.trim().startsWith("cf_clearance=")}==true}
   val sourceField=ExtensionHost::class.java.getDeclaredField("sources");sourceField.isAccessible=true
   val sourceMap=sourceField.get(null) as java.util.concurrent.ConcurrentHashMap<*,*>
   val source=sourceMap[first.getString("sourceId")]?:error("Source instance unavailable")
   val httpSource=source as eu.kanade.tachiyomi.source.online.HttpSource
   var type:Class<*>?=source.javaClass;var popularPath:String?=null
   while(type!=null&&popularPath==null){for(f in type.declaredFields){if(f.type==String::class.java){f.isAccessible=true;val value=f.get(source) as? String;if(value?.contains("hot-manga?page=")==true){popularPath=value;break}}};type=type.superclass}
   val requested=okhttp3.Request.Builder().url(httpSource.baseUrl.trimEnd('/')+"/"+(popularPath?:error("Installed source listing path unavailable"))+"1").build().url
   status("sourceProbeRequest",JSONObject().put("host",requested.host).put("path",requested.encodedPath))
   val events=java.util.concurrent.ConcurrentLinkedQueue<String>()
   if(InstrumentationRegistry.getArguments().getString("nativeBrowser")!="true")ins.runOnMainSync{val previous=browser.webViewClient;browser.webViewClient=object:android.webkit.WebViewClient(){
    private val origins=mutableSetOf(android.net.Uri.parse(url).host?.removePrefix("www."),requested.host.removePrefix("www."))
    override fun shouldOverrideUrlLoading(v:WebView,r:android.webkit.WebResourceRequest):Boolean{if(!r.isForMainFrame)return previous.shouldOverrideUrlLoading(v,r);val u=r.url;val secure=u.scheme=="https"&&u.userInfo==null&&(u.port<0||u.port==443);val h=u.host?.removePrefix("www.");if(secure&&h in origins)return false;if(secure&&r.isRedirect&&origins.size<6){origins.add(h);events.add("Followed HTTPS source redirect to "+u.host);return false};events.add("Blocked navigation (redirect="+r.isRedirect+"): "+u.scheme+"://"+u.host+(u.encodedPath?:""));return true}
    override fun onReceivedError(v:WebView,r:android.webkit.WebResourceRequest,e:android.webkit.WebResourceError){if(r.isForMainFrame)events.add("Network error "+e.errorCode+": "+e.description.toString().take(120));previous.onReceivedError(v,r,e)}
    override fun onReceivedHttpError(v:WebView,r:android.webkit.WebResourceRequest,e:android.webkit.WebResourceResponse){if(r.isForMainFrame)events.add("HTTP "+e.statusCode);previous.onReceivedHttpError(v,r,e)}
    override fun onReceivedSslError(v:WebView,h:android.webkit.SslErrorHandler,e:android.net.http.SslError){events.add("TLS error "+e.primaryError);previous.onReceivedSslError(v,h,e)}
   }}
   var acceptedThirdParty=false;var cookieSupportAdjusted=false
   ins.runOnMainSync{acceptedThirdParty=CookieManager.getInstance().acceptThirdPartyCookies(browser);if(InstrumentationRegistry.getArguments().getString("nativeBrowser")!="true"&&!first.getJSONObject("before").optBoolean("success")&&!acceptedThirdParty){CookieManager.getInstance().setAcceptThirdPartyCookies(browser,true);cookieSupportAdjusted=true;browser.reload()}}
   require(requested.scheme=="https"&&requested.username.isEmpty()&&requested.password.isEmpty())
   ins.runOnMainSync{browser.loadUrl(requested.toString())};Thread.sleep(2500)
   val initialClearance=clearance();screenshot()
   status("sourceProbeBrowser",JSONObject().put("host",android.net.Uri.parse(url).host).put("title",title).put("userAgent",ua).put("systemUserAgent",systemUa).put("hasClearanceCookie",initialClearance).put("thirdPartyCookiesInitiallyEnabled",acceptedThirdParty).put("cookieSupportAdjustedForTest",cookieSupportAdjusted))
   var challenge=false
   for(i in 0 until 90){
    val v=remote(browser,"JSON.stringify({challenge:/verify you are human|just a moment|checking your browser|performing security verification|enable javascript and cookies/i.test((document.title||'')+' '+(document.body?.innerText||'').slice(0,2000)),title:document.title,hasContent:!!document.body?.innerText?.trim(),ready:document.readyState})")
    val decoded=JSONTokener(v).nextValue();val state=if(decoded is String)JSONObject(decoded)else JSONObject()
    challenge=state.optBoolean("challenge");if(i==0)status("sourceProbeChallenge",JSONObject().put("challengeVisible",challenge).put("title",state.optString("title")));if(i>=5&&((!challenge&&state.optBoolean("hasContent"))||clearance()||events.any{it.startsWith("Blocked navigation")||it.startsWith("TLS error")||it.startsWith("Network error")}))break
    Thread.sleep(1000)
   }
   screenshot();ins.runOnMainSync{close?.performClick()};Thread.sleep(300)
   val end="sourceProbeEnd"+System.nanoTime()
   js("""window.$end=null;(async()=>{try{if(featureState.sourceVerification){await api('source_verification_finish',{id:featureState.sourceVerification.id,cancel:false});featureState.sourceVerification=null;}const after=await window.sourceProbeSearch();if(after.success)await checkSourceAvailability(window.sourceProbeId);const baseline=JSON.stringify((await api('snapshot')).progress.map(p=>[p.bookId,p.chapterId,p.page,p.completed,p.updated]).sort());window.$end=JSON.stringify({ok:true,...window.sourceProbeMetadata,before:window.sourceProbeBefore,after,sourceSkipped:sourceIsSkipped(window.sourceProbeId),progressUnchanged:baseline===window.sourceProbeBaseline});}catch(e){window.$end=JSON.stringify({ok:false,error:String(e)})}})()""")
   val result=await(end).put("challengeStillVisible",challenge).put("hasClearanceCookie",clearance()).put("cookieSupportAdjustedForTest",cookieSupportAdjusted).put("browserEvents",org.json.JSONArray(events.toList()));assertTrue("Reading progress changed",result.getBoolean("progressUnchanged"));status("sourceProbeResult",result)
  }finally{ins.runOnMainSync{if(close?.isShown==true)close?.performClick();activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}}
 }}
}
