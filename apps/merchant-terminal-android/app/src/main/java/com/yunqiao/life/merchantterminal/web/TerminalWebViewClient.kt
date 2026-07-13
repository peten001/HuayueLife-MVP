package com.yunqiao.life.merchantterminal.web

import android.annotation.TargetApi
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

class TerminalWebViewClient(
    private val originPolicy: OriginPolicy,
    private val listener: Listener,
) : WebViewClient() {

    interface Listener {
        fun onMainPageStarted(url: String)
        fun onMainPageLoaded(url: String)
        fun onMainPageError(error: TerminalLoadError)
        fun onExternalHttpsRequested(uri: Uri)
        fun onNavigationBlocked(uri: Uri?)
        fun onRendererGone(view: WebView, didCrash: Boolean)
    }

    private var mainFrameFailed = false

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url
        if (originPolicy.isTrustedPage(uri)) return false

        if (!request.isForMainFrame) return true
        if (originPolicy.isSafeExternalHttps(uri)) {
            listener.onExternalHttpsRequested(uri)
        } else {
            listener.onNavigationBlocked(uri)
        }
        return true
    }

    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        return if (originPolicy.isAllowedWebResource(request.url)) {
            null
        } else {
            blockedResourceResponse()
        }
    }

    @Deprecated("Required for old WebView implementations on supported Android versions")
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        if (uri != null && originPolicy.isTrustedPage(uri)) return false
        if (uri != null && originPolicy.isSafeExternalHttps(uri)) {
            listener.onExternalHttpsRequested(uri)
        } else {
            listener.onNavigationBlocked(uri)
        }
        return true
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        mainFrameFailed = false
        listener.onMainPageStarted(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        if (!mainFrameFailed && originPolicy.isTrustedPage(url)) {
            listener.onMainPageLoaded(url)
        }
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (!request.isForMainFrame || mainFrameFailed) return
        showMainFrameError(
            TerminalLoadError(
                type = classify(error.errorCode),
                platformCode = error.errorCode,
                detail = error.description?.toString(),
                failingUrl = originPolicy.sanitizedForDiagnostics(request.url.toString()),
            ),
        )
    }

    @Deprecated("Required for old WebView implementations on supported Android versions")
    override fun onReceivedError(
        view: WebView,
        errorCode: Int,
        description: String?,
        failingUrl: String?,
    ) {
        if (mainFrameFailed) return
        showMainFrameError(
            TerminalLoadError(
                type = classify(errorCode),
                platformCode = errorCode,
                detail = description,
                failingUrl = originPolicy.sanitizedForDiagnostics(failingUrl),
            ),
        )
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (!request.isForMainFrame || mainFrameFailed) return
        showMainFrameError(
            TerminalLoadError(
                type = TerminalLoadErrorType.HTTP_ERROR,
                platformCode = errorResponse.statusCode,
                detail = errorResponse.reasonPhrase,
                failingUrl = originPolicy.sanitizedForDiagnostics(request.url.toString()),
            ),
        )
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // Never bypass an invalid certificate; the only permitted action is cancellation.
        handler.cancel()
        if (mainFrameFailed) return
        showMainFrameError(
            TerminalLoadError(
                type = TerminalLoadErrorType.SSL_ERROR,
                platformCode = error.primaryError,
                detail = "certificate-validation-failed",
                failingUrl = originPolicy.sanitizedForDiagnostics(error.url),
            ),
        )
    }

    @TargetApi(Build.VERSION_CODES.O_MR1)
    override fun onSafeBrowsingHit(
        view: WebView,
        request: WebResourceRequest,
        threatType: Int,
        callback: SafeBrowsingResponse,
    ) {
        callback.backToSafety(true)
        if (request.isForMainFrame && !mainFrameFailed) {
            showMainFrameError(
                TerminalLoadError(
                    type = TerminalLoadErrorType.UNSAFE_RESOURCE,
                    platformCode = threatType,
                    detail = "safe-browsing-blocked",
                    failingUrl = originPolicy.sanitizedForDiagnostics(request.url.toString()),
                ),
            )
        }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        mainFrameFailed = true
        listener.onRendererGone(view, detail.didCrash())
        // The host removes and destroys this WebView. Returning true prevents an app crash.
        return true
    }

    private fun showMainFrameError(error: TerminalLoadError) {
        mainFrameFailed = true
        listener.onMainPageError(error)
    }

    private fun classify(errorCode: Int): TerminalLoadErrorType = when (errorCode) {
        ERROR_HOST_LOOKUP -> TerminalLoadErrorType.DNS_FAILURE
        ERROR_TIMEOUT -> TerminalLoadErrorType.CONNECTION_TIMEOUT
        ERROR_FAILED_SSL_HANDSHAKE -> TerminalLoadErrorType.SSL_ERROR
        ERROR_CONNECT,
        ERROR_PROXY_AUTHENTICATION,
        ERROR_IO,
        ERROR_REDIRECT_LOOP,
        ERROR_TOO_MANY_REQUESTS,
        ERROR_UNKNOWN,
        -> TerminalLoadErrorType.PAGE_LOAD_FAILURE
        ERROR_UNSUPPORTED_AUTH_SCHEME,
        ERROR_AUTHENTICATION,
        ERROR_BAD_URL,
        ERROR_UNSUPPORTED_SCHEME,
        ERROR_FILE,
        ERROR_FILE_NOT_FOUND,
        -> TerminalLoadErrorType.PAGE_LOAD_FAILURE
        else -> TerminalLoadErrorType.PAGE_LOAD_FAILURE
    }

    private fun blockedResourceResponse(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Blocked by terminal origin policy",
        emptyMap(),
        ByteArrayInputStream(ByteArray(0)),
    )
}
