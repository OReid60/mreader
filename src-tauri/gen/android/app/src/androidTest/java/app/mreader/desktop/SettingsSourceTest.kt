package app.mreader.desktop

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class SettingsSourceTest {
 @Test fun removeProbeBaseline() {
  val ins=InstrumentationRegistry.getInstrumentation()
  File(ins.targetContext.cacheDir,"settings-progress-baseline.sha256").delete()
 }
 @Test fun settingsControlsPreserveProgress() = CoverSyncTest().withReader { js, _ ->
  val ins=InstrumentationRegistry.getInstrumentation()
  val args=InstrumentationRegistry.getArguments()
  val script=String(android.util.Base64.decode(args.getString("probeScript")?:error("Missing probe"),android.util.Base64.DEFAULT),Charsets.UTF_8)
  js(script)
  js("window.settingsProbeResult=null;runSettingsProbe(${JSONObject.quote(args.getString("phase")?:"prepare")}).then(r=>window.settingsProbeResult=JSON.stringify({ok:true,...r})).catch(e=>window.settingsProbeResult=JSON.stringify({ok:false,error:String(e)}));")
  var result:JSONObject?=null
  for(i in 0 until 600){val value=JSONTokener(js("window.settingsProbeResult||''")).nextValue();if(value is String&&value.isNotEmpty()){result=JSONObject(value);break};Thread.sleep(100)}
  val proof=result?:error("Settings test timed out");assertTrue(proof.optString("error"),proof.optBoolean("ok"))
  val hash=MessageDigest.getInstance("SHA-256").digest(proof.getString("progress").toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
  val baseline=File(ins.targetContext.cacheDir,"settings-progress-baseline.sha256")
  if(baseline.exists())assertEquals("Progress changed across restart/update",baseline.readText(),hash)
  baseline.writeText(hash);proof.remove("progress");proof.put("progressSha256",hash)
  ins.sendStatus(0,android.os.Bundle().apply{putString("settingsProof",proof.toString())})
 }
}
