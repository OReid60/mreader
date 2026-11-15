package app.mreader.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import android.graphics.Color
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.webkit.WebView
import android.webkit.JavascriptInterface
import android.net.Uri
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  private var readerImmersive = false
  private var readerBack: OnBackPressedCallback? = null
  private var backInFlight = false
  private var contentWebView: WebView? = null
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    contentWebView = webView
    webView.addJavascriptInterface(ReaderChrome(this, webView), "MreaderChrome")
    readerBack = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val content = findViewById<View>(android.R.id.content)
        if (ViewCompat.getRootWindowInsets(content)?.isVisible(WindowInsetsCompat.Type.ime()) == true) {
          WindowInsetsControllerCompat(window, content).hide(WindowInsetsCompat.Type.ime())
          return
        }
        if (backInFlight) return
        backInFlight = true
        webView.evaluateJavascript("typeof handleAppBack === 'function' ? handleAppBack() : true") { handled ->
          backInFlight = false
          if (handled == "false") {
            isEnabled = false
            try { onBackPressedDispatcher.onBackPressed() } finally { isEnabled = true }
          }
        }
      }
    }.also { onBackPressedDispatcher.addCallback(this, it) }
  }
  fun setReaderImmersive(enabled: Boolean) {
    readerImmersive = enabled
    WindowInsetsControllerCompat(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      if (enabled) hide(WindowInsetsCompat.Type.systemBars()) else show(WindowInsetsCompat.Type.systemBars())
    }
    ViewCompat.requestApplyInsets(findViewById(android.R.id.content))
  }
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && readerImmersive) setReaderImmersive(true)
  }
  override fun onResume() {
    super.onResume()
    if (intent?.getBooleanExtra("mreaderDownloads", false) == true) {
      intent.removeExtra("mreaderDownloads")
      contentWebView?.post { contentWebView?.evaluateJavascript("if(typeof navigate==='function')navigate('Downloads')",null) }
    }
  }
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent); setIntent(intent)
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.rgb(44, 19, 12))
    )
    super.onCreate(savedInstanceState)
    findViewById<View>(android.R.id.content).setBackgroundColor(Color.rgb(27, 9, 5))
    ViewCompat.setOnApplyWindowInsetsListener(findViewById<View>(android.R.id.content)) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
      if (readerImmersive) view.setPadding(0, 0, 0, keyboard.bottom)
      else view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
      insets
    }
  }
}

class ReaderChrome(private val activity: MainActivity, private val webView: WebView) {
  @JavascriptInterface
  fun requestDownloadNotifications() {
    activity.runOnUiThread {
      if (Uri.parse(webView.url ?: "").host == "tauri.localhost" && android.os.Build.VERSION.SDK_INT >= 33 &&
        androidx.core.content.ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
        androidx.core.app.ActivityCompat.requestPermissions(activity,arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),410)
      }
    }
  }
  @JavascriptInterface
  fun setImmersive(enabled: Boolean) {
    activity.runOnUiThread {
      if (Uri.parse(webView.url ?: "").host == "tauri.localhost") activity.setReaderImmersive(enabled)
    }
  }
}
