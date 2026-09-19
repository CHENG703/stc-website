package top.stcwork.filemanager.transfer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import top.stcwork.filemanager.MainActivity
import top.stcwork.filemanager.R

/**
 * 手机互传的前台服务：让分享在切到后台/锁屏时也能继续被对方下载。
 * 只有「发送方」需要它；接收方是普通网络请求，不占服务。
 */
class ShareService : Service() {

    companion object {
        const val ACTION_START = "top.stcwork.filemanager.SHARE_START"
        const val ACTION_STOP = "top.stcwork.filemanager.SHARE_STOP"
        private const val CHANNEL = "stc_phone_share"
        private const val NOTIFY_ID = 2101
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            ShareHub.stop()
            stopNow()
            return START_NOT_STICKY
        }
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFY_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFY_ID, notification)
        }
        ShareHub.start(Build.MODEL?.takeIf { it.isNotBlank() } ?: "STC手机")
        return START_STICKY
    }

    override fun onDestroy() {
        ShareHub.stop()
        super.onDestroy()
    }

    /** 配对码变了就刷新一下通知 */
    fun refreshNotification() {
        runCatching {
            getSystemService(NotificationManager::class.java)?.notify(NOTIFY_ID, buildNotification())
        }
    }

    private fun stopNow() {
        @Suppress("DEPRECATION")
        runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
        runCatching { stopSelf() }
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL, "手机互传", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "向另一台手机分享文件时保持连接" }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, ShareService::class.java).setAction(ACTION_STOP),
            flags
        )
        val code = ShareHub.state.value.code
        val text = if (ShareHub.state.value.running && code.isNotBlank()) {
            "分享中 · 配对码 $code"
        } else {
            "正在开启手机互传"
        }
        return NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("STC 手机互传")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(open)
            .addAction(0, "停止分享", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }
}
