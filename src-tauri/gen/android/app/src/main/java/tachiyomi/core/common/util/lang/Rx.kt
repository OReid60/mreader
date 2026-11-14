package tachiyomi.core.common.util.lang
import rx.Observable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
suspend fun <T> Observable<T>.awaitSingle(): T = suspendCancellableCoroutine { c ->
    val subscription = single().subscribe({ if(c.isActive)c.resume(it) }, { if(c.isActive)c.resumeWithException(it) })
    c.invokeOnCancellation { subscription.unsubscribe() }
}
