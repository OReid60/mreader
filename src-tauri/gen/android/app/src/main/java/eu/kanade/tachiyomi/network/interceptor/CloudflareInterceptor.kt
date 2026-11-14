package eu.kanade.tachiyomi.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** API-compatible marker used by extension request policies. Does not solve challenges. */
class CloudflareInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response=chain.proceed(chain.request())
        if(response.header("cf-mitigated")=="challenge") {
            response.close()
            throw IOException("This website requires browser verification. Complete verification on the source website before retrying.")
        }
        return response
    }
}
