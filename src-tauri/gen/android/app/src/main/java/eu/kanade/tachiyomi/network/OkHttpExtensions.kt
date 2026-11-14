package eu.kanade.tachiyomi.network

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.*
import rx.Observable
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

fun Call.asObservable(): Observable<Response> = Observable.defer {
    val call = clone()
    Observable.create { subscriber ->
        subscriber.add(rx.subscriptions.Subscriptions.create { call.cancel() })
        try { val response=call.execute(); if (!subscriber.isUnsubscribed) {subscriber.onNext(response); subscriber.onCompleted()} else response.close() }
        catch(e: Exception) {if (!subscriber.isUnsubscribed) subscriber.onError(e)}
    }
}
fun Call.asObservableSuccess(): Observable<Response> = asObservable().map { response ->
    if (!response.isSuccessful) { val code=response.code;response.close();throw HttpException(code) };response
}
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object: Callback {
        override fun onFailure(call: Call,e: IOException) {if(cont.isActive)cont.resumeWithException(e)}
        override fun onResponse(call: Call,response: Response) {if(cont.isActive)cont.resume(response) else response.close()}
    })
}
suspend fun Call.awaitSuccess(): Response = await().also { if (!it.isSuccessful) {val code=it.code;it.close();throw HttpException(code)} }
fun OkHttpClient.newCachelessCallWithProgress(request: Request, listener: ProgressListener, existingSize: Long=0L): Call = newBuilder().cache(null).addNetworkInterceptor { chain ->
    val response=chain.proceed(request.newBuilder().apply {if(existingSize>0)header("Range","bytes=$existingSize-")}.build())
    response.newBuilder().body(ProgressResponseBody(response.body,listener,if(response.code==206)existingSize else 0)).build()
}.build().newCall(request)
