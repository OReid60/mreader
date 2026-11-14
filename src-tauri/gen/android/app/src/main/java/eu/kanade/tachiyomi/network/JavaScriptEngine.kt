package eu.kanade.tachiyomi.network
import android.content.Context
import app.cash.quickjs.QuickJs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Compatibility service for sources that evaluate JavaScript. */
@Suppress("UNUSED_PARAMETER", "UNCHECKED_CAST")
class JavaScriptEngine(context: Context) {
    suspend fun <T> evaluate(script: String): T = withContext(Dispatchers.Default) {
        QuickJs.create().use { it.evaluate(script) as T }
    }
}
