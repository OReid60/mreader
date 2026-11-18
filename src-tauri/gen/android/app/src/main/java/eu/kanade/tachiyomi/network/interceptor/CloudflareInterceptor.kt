package eu.kanade.tachiyomi.network.interceptor

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

/** A user-opened browser must visit the actual challenged resource, not just its homepage. */
class BrowserVerificationRequiredException(val targetUrl:String,val browserUserAgent:String?) : IOException("This website requires browser verification. Complete verification on the source website before retrying.")

/** Detects challenges and leaves their completion to the source browser/user. */
class CloudflareInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val response=chain.proceed(chain.request())
        if(response.header("cf-mitigated")=="challenge") {
            val challenge=BrowserVerificationRequiredException(response.request.url.toString(),response.request.header("User-Agent"))
            response.close()
            throw challenge
        }
        return response
    }
}
