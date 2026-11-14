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
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(ReaderChrome(this, webView), "MreaderChrome")
    readerBack = object : OnBackPressedCallback(false) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("if (typeof setReaderFullscreen === 'function') setReaderFullscreen(false)", null)
        setReaderImmersive(false)
      }
    }.also { onBackPressedDispatcher.addCallback(this, it) }
  }
  fun setReaderImmersive(enabled: Boolean) {
    readerImmersive = enabled
    readerBack?.isEnabled = enabled
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
  fun setImmersive(enabled: Boolean) {
    activity.runOnUiThread {
      if (Uri.parse(webView.url ?: "").host == "tauri.localhost") activity.setReaderImmersive(enabled)
    }
  }
}
