package com.yunqiao.life.merchantterminal.web

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.webkit.CookieManager
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.yunqiao.life.merchantterminal.BuildConfig

class TerminalWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = android.R.attr.webViewStyle,
) : WebView(context, attrs, defStyleAttr) {

    init {
        configureForTerminal()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureForTerminal() {
        setBackgroundColor(Color.WHITE)
        isFocusable = true
        isFocusableInTouchMode = true

        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            loadsImagesAutomatically = true
            blockNetworkImage = false
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mediaPlaybackRequiresUserGesture = true
            userAgentString = appendTerminalUserAgent(userAgentString)
        }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(settings, true)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            // Current merchant authentication uses a same-origin bearer token in localStorage.
            // Keep cross-site cookies disabled unless a future audited login flow requires them.
            setAcceptThirdPartyCookies(this@TerminalWebView, false)
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    }

    fun flushSessionState() {
        CookieManager.getInstance().flush()
    }

    private fun appendTerminalUserAgent(current: String?): String {
        val base = current.orEmpty().trim()
        return if (base.contains(BuildConfig.TERMINAL_USER_AGENT)) {
            base
        } else {
            "$base ${BuildConfig.TERMINAL_USER_AGENT}".trim()
        }
    }
}
