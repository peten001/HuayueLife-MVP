package com.yunqiao.life.merchantterminal.web

import android.webkit.JavascriptInterface
import androidx.annotation.Keep
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.yunqiao.life.merchantterminal.security.MerchantWebSessionContract
import com.yunqiao.life.merchantterminal.security.MerchantSessionStopReason

class TrustedWebMessageBridge(
    private val originPolicy: OriginPolicy,
    private val onSignedOut: (MerchantSessionStopReason) -> Unit,
    private val onSessionChanged: () -> Unit,
    private val onLanguageChanged: (String) -> Unit,
    private val onOpenPrinterDevices: () -> Unit,
) {
    fun install(webView: TerminalWebView): Boolean {
        if (!originPolicy.isConfigured) {
            return false
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            webView.addJavascriptInterface(PrinterDevicesJavascriptBridge(onOpenPrinterDevices), MerchantWebSessionContract.PRINTER_DEVICES_OBJECT_NAME)
            return true
        }
        val sessionInstalled = runCatching {
            WebViewCompat.addWebMessageListener(
                webView,
                MerchantWebSessionContract.SIGNAL_OBJECT_NAME,
                setOf("*"),
                WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
                    if (
                        !isMainFrame ||
                        !originPolicy.isTrustedPage(sourceOrigin) ||
                        message.type != WebMessageCompat.TYPE_STRING
                    ) {
                        return@WebMessageListener
                    }
                    when {
                        MerchantWebSessionContract.isSignOutMessage(message.data) ->
                            onSignedOut(MerchantWebSessionContract.signOutReason(message.data?.substringAfter(':', "")))
                        message.data == MerchantWebSessionContract.SESSION_CHANGED_MESSAGE -> onSessionChanged()
                        else -> MerchantWebSessionContract.languageFromSignal(message.data)?.let(onLanguageChanged)
                    }
                },
            )
        }.isSuccess
        var printerDevicesInstalled = runCatching {
            WebViewCompat.addWebMessageListener(
                webView,
                MerchantWebSessionContract.PRINTER_DEVICES_OBJECT_NAME,
                setOf("*"),
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
        printerDevicesInstalled = runCatching {
            webView.addJavascriptInterface(
                PrinterDevicesJavascriptBridge(onOpenPrinterDevices),
                MerchantWebSessionContract.PRINTER_DEVICES_OBJECT_NAME,
            )
        }.isSuccess || printerDevicesInstalled
        return sessionInstalled && printerDevicesInstalled
    }

    @Keep
    class PrinterDevicesJavascriptBridge(
        private val onOpenPrinterDevices: () -> Unit,
    ) {
        @JavascriptInterface
        fun postMessage(message: String?) {
            if (message != null && MerchantWebSessionContract.isOpenPrinterDevicesMessage(message)) {
                onOpenPrinterDevices()
            }
        }
    }
}
