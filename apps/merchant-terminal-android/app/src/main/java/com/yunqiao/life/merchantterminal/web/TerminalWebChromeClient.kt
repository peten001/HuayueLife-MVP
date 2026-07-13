package com.yunqiao.life.merchantterminal.web

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import com.yunqiao.life.merchantterminal.BuildConfig
import com.yunqiao.life.merchantterminal.R

class TerminalWebChromeClient(
    private val context: Context,
    private val originPolicy: OriginPolicy,
    private val host: Host,
) : WebChromeClient() {

    interface Host {
        fun onProgressChanged(progress: Int)
        fun openFileChooser(
            acceptTypes: Array<String>,
            allowMultiple: Boolean,
            callback: ValueCallback<Array<Uri>>,
        )
        fun onNewWindowUrl(url: String)
        fun onPopupBlocked()
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val transientPopups = mutableSetOf<WebView>()

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        host.onProgressChanged(newProgress.coerceIn(0, 100))
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean {
        if (!originPolicy.isTrustedPage(webView.url)) {
            filePathCallback.onReceiveValue(null)
            return false
        }

        val acceptTypes = fileChooserParams.acceptTypes
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toTypedArray()
        host.openFileChooser(
            acceptTypes = acceptTypes,
            allowMultiple = fileChooserParams.mode == FileChooserParams.MODE_OPEN_MULTIPLE,
            callback = filePathCallback,
        )
        return true
    }

    override fun onJsAlert(
        view: WebView,
        url: String,
        message: String,
        result: JsResult,
    ): Boolean {
        if (!originPolicy.isTrustedPage(url)) {
            result.cancel()
            return true
        }
        AlertDialog.Builder(context)
            .setMessage(message.take(MAX_DIALOG_TEXT))
            .setPositiveButton(R.string.web_dialog_ok) { _, _ -> result.confirm() }
            .setOnCancelListener { result.cancel() }
            .show()
        return true
    }

    override fun onJsConfirm(
        view: WebView,
        url: String,
        message: String,
        result: JsResult,
    ): Boolean {
        if (!originPolicy.isTrustedPage(url)) {
            result.cancel()
            return true
        }
        AlertDialog.Builder(context)
            .setMessage(message.take(MAX_DIALOG_TEXT))
            .setPositiveButton(R.string.web_dialog_ok) { _, _ -> result.confirm() }
            .setNegativeButton(R.string.web_dialog_cancel) { _, _ -> result.cancel() }
            .setOnCancelListener { result.cancel() }
            .show()
        return true
    }

    override fun onJsPrompt(
        view: WebView,
        url: String,
        message: String,
        defaultValue: String?,
        result: JsPromptResult,
    ): Boolean {
        if (!originPolicy.isTrustedPage(url)) {
            result.cancel()
            return true
        }
        val input = EditText(context).apply {
            setSingleLine(false)
            setText(defaultValue.orEmpty().take(MAX_PROMPT_TEXT))
            setSelection(text.length)
        }
        AlertDialog.Builder(context)
            .setMessage(message.take(MAX_DIALOG_TEXT))
            .setView(input)
            .setPositiveButton(R.string.web_dialog_ok) { _, _ ->
                result.confirm(input.text?.toString().orEmpty().take(MAX_PROMPT_TEXT))
            }
            .setNegativeButton(R.string.web_dialog_cancel) { _, _ -> result.cancel() }
            .setOnCancelListener { result.cancel() }
            .show()
        return true
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        // Stage 1 does not need camera, microphone, location or protected-media access.
        request.deny()
    }

    override fun onGeolocationPermissionsShowPrompt(
        origin: String,
        callback: GeolocationPermissions.Callback,
    ) {
        callback.invoke(origin, false, false)
    }

    override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message,
    ): Boolean {
        if (!isUserGesture || !originPolicy.isTrustedPage(view.url)) {
            host.onPopupBlocked()
            return false
        }

        // Use a no-JavaScript, unattached WebView only to capture a target=_blank URL. It never
        // receives native interfaces and is destroyed immediately after the URL is routed.
        val popup = WebView(view.context).apply {
            settings.apply {
                javaScriptEnabled = false
                domStorageEnabled = false
                allowFileAccess = false
                allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                setSupportMultipleWindows(false)
            }
        }
        transientPopups += popup
        popup.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(popupView: WebView, url: String): Boolean {
                routePopupUrl(popupView, url)
                return true
            }

            override fun shouldOverrideUrlLoading(
                popupView: WebView,
                request: android.webkit.WebResourceRequest,
            ): Boolean {
                routePopupUrl(popupView, request.url.toString())
                return true
            }

            override fun onPageStarted(popupView: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (url != "about:blank") routePopupUrl(popupView, url)
            }
        }

        val transport = resultMsg.obj as? WebView.WebViewTransport ?: run {
            destroyPopup(popup)
            return false
        }
        transport.webView = popup
        resultMsg.sendToTarget()
        mainHandler.postDelayed({ destroyPopup(popup) }, POPUP_CAPTURE_TIMEOUT_MS)
        return true
    }

    override fun onCloseWindow(window: WebView) {
        destroyPopup(window)
    }

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        // Do not copy page logs into production logs: they may contain business data.
        return if (BuildConfig.DEBUG) super.onConsoleMessage(consoleMessage) else true
    }

    fun destroyTransientWindows() {
        transientPopups.toList().forEach(::destroyPopup)
    }

    private fun routePopupUrl(popup: WebView, url: String) {
        if (url == "about:blank") return
        popup.stopLoading()
        host.onNewWindowUrl(url)
        destroyPopup(popup)
    }

    private fun destroyPopup(popup: WebView) {
        if (!transientPopups.remove(popup)) return
        mainHandler.removeCallbacksAndMessages(popup)
        (popup.parent as? ViewGroup)?.removeView(popup)
        popup.stopLoading()
        popup.webChromeClient = null
        popup.webViewClient = WebViewClient()
        popup.destroy()
    }

    private companion object {
        const val MAX_DIALOG_TEXT = 2_000
        const val MAX_PROMPT_TEXT = 4_000
        const val POPUP_CAPTURE_TIMEOUT_MS = 5_000L
    }
}
