package com.yunqiao.life.merchantterminal.web

import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.security.MerchantWebSessionContract

class TrustedWebMessageBridge(
    private val originPolicy: OriginPolicy,
    private val onSignedOut: () -> Unit,
    private val onSessionChanged: () -> Unit,
    private val onOpenPrinterDevices: () -> Unit,
) {
    fun install(webView: TerminalWebView): Boolean {
        if (
            !originPolicy.isConfigured ||
            !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            return false
        }
        val exactOrigin = BuildConfig.TRUSTED_PAGE_ORIGIN.trim().removeSuffix("/")
        val sessionInstalled = runCatching {
            WebViewCompat.addWebMessageListener(
                webView,
                MerchantWebSessionContract.SIGNAL_OBJECT_NAME,
                setOf(exactOrigin),
                WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
                    if (
                        !isMainFrame ||
                        !originPolicy.isTrustedPage(sourceOrigin) ||
                        message.type != WebMessageCompat.TYPE_STRING
                    ) {
                        return@WebMessageListener
                    }
                    when (message.data) {
                        MerchantWebSessionContract.SIGN_OUT_MESSAGE -> onSignedOut()
                        MerchantWebSessionContract.SESSION_CHANGED_MESSAGE -> onSessionChanged()
                    }
                },
            )
        }.isSuccess
        val printerDevicesInstalled = runCatching {
            WebViewCompat.addWebMessageListener(
                webView,
                MerchantWebSessionContract.PRINTER_DEVICES_OBJECT_NAME,
                setOf(exactOrigin),
                WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
                    if (
                        isMainFrame &&
                        originPolicy.isTrustedPage(sourceOrigin) &&
                        message.type == WebMessageCompat.TYPE_STRING &&
                        MerchantWebSessionContract.isOpenPrinterDevicesMessage(message.data)
                    ) {
                        onOpenPrinterDevices()
                    }
                },
            )
        }.isSuccess
        return sessionInstalled && printerDevicesInstalled
    }
}
