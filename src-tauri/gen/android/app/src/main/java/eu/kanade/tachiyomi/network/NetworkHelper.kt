package eu.kanade.tachiyomi.network

import android.content.Context
import okhttp3.Cache
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/** Host services for real extension bytecode; no anti-bot bypass service. */
class NetworkHelper(context: Context) {
    val cookieJar = AndroidCookieJar()
    fun defaultUserAgentProvider(): String = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36 Mreader/0.4"
    val client: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(eu.kanade.tachiyomi.network.interceptor.UncaughtExceptionInterceptor())
        .addInterceptor(eu.kanade.tachiyomi.network.interceptor.UserAgentInterceptor(::defaultUserAgentProvider))
        .addInterceptor(eu.kanade.tachiyomi.network.interceptor.CloudflareInterceptor())
        .cache(Cache(File(context.cacheDir,"extension-http"), 32L*1024*1024))
        .connectTimeout(20,TimeUnit.SECONDS).readTimeout(60,TimeUnit.SECONDS)
        .build()
    val cloudflareClient: OkHttpClient get() = client
}
