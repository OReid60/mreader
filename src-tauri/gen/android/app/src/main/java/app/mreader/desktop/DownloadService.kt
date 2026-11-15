package app.mreader.desktop

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** The Rust queue owns all transfers; this service keeps the process/CPU active. */
class DownloadService : Service() {
  private var wake: PowerManager.WakeLock? = null
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "stop") { stopSelf(); return START_NOT_STICKY }
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("downloads", "Manga downloads", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).putExtra("mreaderDownloads", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, "downloads")
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("Mreader downloads")
      .setContentText(intent?.getStringExtra("text") ?: "Downloading chapters")
      .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
      .setProgress(intent?.getIntExtra("total",0) ?: 0, intent?.getIntExtra("done",0) ?: 0, intent?.getIntExtra("total",0) == 0).build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(410, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(410, notification)
    if (wake == null) {
      wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Mreader:Downloads").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
    }
    running = true
    // Explicit restart/force-stop requires reopening Mreader and resuming its saved queue.
    return START_NOT_STICKY
  }
  override fun onTimeout(startId: Int, fgsType: Int) { pauseNative(); stopSelf() }
  override fun onDestroy() {
    running = false
    wake?.let { if (it.isHeld) it.release() }; wake = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
  companion object {
    @Volatile private var running = false
    @JvmStatic external fun pauseNative()
    @JvmStatic fun update(context: Context, active: Boolean, text: String, done: Int, total: Int) {
      val intent = Intent(context.applicationContext, DownloadService::class.java)
      if (!active) { running = false; context.applicationContext.stopService(intent); return }
      intent.putExtra("text", text).putExtra("done", done).putExtra("total", total)
      if (running) context.applicationContext.startService(intent)
      else ContextCompat.startForegroundService(context.applicationContext, intent)
    }
  }
}
