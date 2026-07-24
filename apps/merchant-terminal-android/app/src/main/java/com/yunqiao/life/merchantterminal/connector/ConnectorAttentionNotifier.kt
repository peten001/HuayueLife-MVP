package com.yunqiao.life.merchantterminal.connector

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolution
import com.yunqiao.life.merchantterminal.printing.usb.UsbBindingResolver
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.security.MerchantSessionTokenStore

/** User-visible recovery hint; never contains a token, job, order, or customer field. */
object ConnectorAttentionNotifier {
    suspend fun showUsbIssueIfNeeded(context: Context) {
        val app = context.applicationContext
        val settings = ConnectorSettings(app).snapshot()
        if (!settings.cachedRemoteStartEligible || settings.usbBinding == null ||
            !MerchantSessionTokenStore(app).hasCredential()
        ) return
        val resolution = UsbBindingResolver.resolve(
            settings.usbBinding,
            UsbDeviceInspector(app).scan(),
        )
        if (resolution is UsbBindingResolution.Ready) {
            clear(app)
            return
        }
        val errorCode = (resolution as UsbBindingResolution.Unavailable).errorCode
        val message = if (errorCode == "USB_PERMISSION_REQUIRED") {
            "USB 权限已失效，请打开终端设置重新授权"
        } else {
            "USB 打印机需要检查：${errorCode.take(50)}"
        }
        show(app, message)
    }

    fun showServiceRestartRequired(context: Context) {
        show(
            context.applicationContext,
            "Android 阻止了后台启动打印服务。请点此打开云桥终端以安全恢复。",
        )
    }

    private fun show(app: Context, message: String) {
        val manager = app.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "云桥终端需要处理",
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
        val intent = PendingIntent.getActivity(
            app,
            0,
            Intent(app, ConnectorControlActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        manager.notify(
            NOTIFICATION_ID,
            NotificationCompat.Builder(app, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle("云桥打印连接器需要处理")
                .setContentText(message)
                .setStyle(NotificationCompat.BigTextStyle().bigText(message))
                .setContentIntent(intent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build(),
        )
    }

    fun clear(context: Context) {
        context.applicationContext.getSystemService(NotificationManager::class.java)
            .cancel(NOTIFICATION_ID)
    }

    private const val CHANNEL_ID = "merchant_connector_attention"
    private const val NOTIFICATION_ID = 8_302
}
