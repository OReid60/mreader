package app.mreader.desktop
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class VerificationTargetTest {
 @Test fun exactChallengeTargetVersionAndSourceIsolation(){CoverSyncTest().withReader {js,invoke ->
  val ins=InstrumentationRegistry.getInstrumentation();val context=ins.targetContext
  val before=(invoke("snapshot",JSONObject()) as JSONObject).getJSONArray("progress").toString()
  val expected=context.packageManager.getPackageInfo(context.packageName,0).versionName
  for(i in 0 until 100){if(js("!!featureState.appVersion")=="true")break;Thread.sleep(100)}
  assertEquals(JSONObject.quote(expected),js("state.page='Settings';featureState.settingsTab='general';render();document.querySelector('[aria-label=\"Installed app version\"]').textContent"))
  val ids=listOf("9223372036854775701","9223372036854775702")
  val sf=ExtensionHost::class.java.getDeclaredField("sources");sf.isAccessible=true
  @Suppress("UNCHECKED_CAST") val sources=sf.get(null) as java.util.concurrent.ConcurrentHashMap<String,eu.kanade.tachiyomi.source.Source>
  val tf=ExtensionHost::class.java.getDeclaredField("verificationTargets");tf.isAccessible=true
  @Suppress("UNCHECKED_CAST") val targets=tf.get(null) as java.util.concurrent.ConcurrentHashMap<String,Any>
  assertTrue(ids.none{sources.containsKey(it)||targets.containsKey(it)})
  fun fake(testId:String)=object:eu.kanade.tachiyomi.source.online.HttpSource(){
   override val id=testId.toLong();override val name="Mreader verification unit test";override val lang="en";override val supportsLatest=false;override val baseUrl="https://old.example"
   override fun headersBuilder()=okhttp3.Headers.Builder().add("User-Agent","Source default UA")
   override suspend fun getPopularManga(page:Int):eu.kanade.tachiyomi.source.model.MangasPage=throw eu.kanade.tachiyomi.network.interceptor.BrowserVerificationRequiredException("https://new.example/protected/list?page=1","Request-specific UA")
  }
  fun call(id:String,op:String)=JSONObject(ExtensionHost.request(context,JSONObject().put("sourceId",id).put("operation",op).put("query","").put("page",1).toString()))
  try {
   ids.forEach{sources[it]=fake(it)}
   assertTrue(call(ids[0],"search").getString("error").contains("browser verification"))
   val selected=call(ids[0],"source_info").getJSONObject("data")
   assertEquals("https://new.example/protected/list?page=1",selected.getString("url"));assertEquals("Request-specific UA",selected.getString("userAgent"))
   val other=call(ids[1],"source_info").getJSONObject("data");assertEquals("https://old.example",other.getString("url"));assertEquals("Source default UA",other.getString("userAgent"))
  }finally{ids.forEach{sources.remove(it);targets.remove(it)}}
  assertEquals("Reading progress changed",before,(invoke("snapshot",JSONObject()) as JSONObject).getJSONArray("progress").toString())
  ins.sendStatus(0,android.os.Bundle().apply{putString("verificationTargetProof",JSONObject().put("installedVersion",expected).put("versionVisible",true).put("exactChallengePage",true).put("matchingRequestAgent",true).put("otherSourceIsolated",true).put("testSourcesRemoved",true).put("progressUnchanged",true).toString())})
 }}
}
