package app.mreader.desktop
import android.app.Dialog
import android.webkit.*
import android.widget.*
import android.net.Uri
import android.os.Handler
import android.os.Looper
import java.lang.ref.WeakReference
object SourceVerificationBrowser {
 var activity:WeakReference<MainActivity>?=null
 private var dialog:Dialog?=null
 fun open(url:String,agent:String){
  val current=activity?.get()?:error("Reader activity is unavailable")
  Handler(Looper.getMainLooper()).post {
   dialog?.dismiss()
   val base=Uri.parse(url);val host=base.host?.removePrefix("www.");val port=if(base.port<0)443 else base.port
   val content=LinearLayout(current).apply{orientation=LinearLayout.VERTICAL}
   content.setBackgroundColor(android.graphics.Color.rgb(27,9,5))
   androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(content){view,insets ->
    val bars=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
    val keyboard=insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.ime())
    view.setPadding(bars.left,bars.top,bars.right,maxOf(bars.bottom,keyboard.bottom));insets
   }
   val browser=WebView(current).apply{
    settings.javaScriptEnabled=true;settings.domStorageEnabled=true;settings.userAgentString=agent
    settings.allowFileAccess=false;settings.allowContentAccess=false;settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
    val allowedHosts=mutableSetOf(host)
    webViewClient=object:WebViewClient(){
     override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
      if(!request.isForMainFrame)return false
      val next=request.url;val nextHost=next.host?.removePrefix("www.")
      if(next.scheme!="https"||next.userInfo!=null||(if(next.port<0)443 else next.port)!=port||nextHost==null)return true
      if(nextHost in allowedHosts)return false
      if(request.isRedirect&&allowedHosts.size<6){allowedHosts.add(nextHost);return false}
      return true
     }
     override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:android.net.http.SslError){handler.cancel()}
    }
    setDownloadListener{_,_,_,_,_->};CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(this,true)
   }
   val close=Button(current).apply{text="Return to Mreader";setOnClickListener{CookieManager.getInstance().flush();dialog?.dismiss()}}
   content.addView(close);content.addView(browser,LinearLayout.LayoutParams(-1,0,1f))
   val shown=Dialog(current,android.R.style.Theme_DeviceDefault_NoActionBar)
   shown.setContentView(content);shown.setOnDismissListener{browser.destroy();if(dialog===shown)dialog=null};dialog=shown;shown.show();shown.window?.setLayout(-1,-1)
   shown.window?.let{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(it,false)}
   androidx.core.view.ViewCompat.requestApplyInsets(content)
   browser.loadUrl(url)
  }
 }
 fun finish(){CookieManager.getInstance().flush();Handler(Looper.getMainLooper()).post{dialog?.dismiss()}}
}
