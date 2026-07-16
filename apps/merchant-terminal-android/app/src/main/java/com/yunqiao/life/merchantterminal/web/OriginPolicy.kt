package com.yunqiao.life.merchantterminal.web

import android.net.Uri
import com.yunqiao.life.merchantterminal.BuildConfig
import java.net.IDN
import java.util.Locale

/**
 * Separates the privileged Web cashier page origin from its resource/API allowlist.
 *
 * Only [BuildConfig.TRUSTED_PAGE_ORIGIN] may navigate inside the WebView or request privileged
 * browser UI. [BuildConfig.TRUSTED_RESOURCE_HOSTS] only grants HTTPS resource access and never
 * grants page-origin privileges. Wildcards are deliberately unsupported.
 */
class OriginPolicy(
    startUrl: String = BuildConfig.CASHIER_WEB_URL,
    trustedPageOrigin: String = BuildConfig.TRUSTED_PAGE_ORIGIN,
    trustedResourceHosts: String = BuildConfig.TRUSTED_RESOURCE_HOSTS,
) {
    private val parsedStartUri = parseHttpsUri(startUrl)
    private val parsedTrustedOrigin = parseHttpsOrigin(trustedPageOrigin)
    private val trustedHost = parsedTrustedOrigin?.host?.toAsciiHost()
    private val trustedPort = parsedTrustedOrigin?.effectiveHttpsPort()
    private val allowedResourceHosts: Set<String> = buildSet {
        trustedResourceHosts
            .split(',')
            .asSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .mapNotNull { it.toAsciiHost() }
            .forEach(::add)
    }

    val startUri: Uri?
        get() = parsedStartUri

    val startUrl: String
        get() = parsedStartUri?.toString().orEmpty()

    val isConfigured: Boolean
        get() = parsedStartUri != null &&
            parsedTrustedOrigin != null &&
            trustedHost != null &&
            hasSameOrigin(parsedStartUri, parsedTrustedOrigin)

    fun isTrustedPage(url: String?): Boolean =
        url?.let { runCatching { Uri.parse(it) }.getOrNull() }?.let(::isTrustedPage) == true

    fun isTrustedPage(uri: Uri): Boolean {
        if (!uri.scheme.equals(HTTPS_SCHEME, ignoreCase = true)) return false
        if (uri.isOpaque || uri.encodedAuthority?.contains('@') == true) return false

        val host = uri.host?.toAsciiHost() ?: return false
        val port = uri.effectiveHttpsPort() ?: return false
        return host == trustedHost && port == trustedPort
    }

    fun isSafeExternalHttps(uri: Uri): Boolean =
        uri.scheme.equals(HTTPS_SCHEME, ignoreCase = true) &&
            !uri.isOpaque &&
            uri.encodedAuthority?.contains('@') != true &&
            uri.host?.toAsciiHost() != null &&
            uri.effectiveHttpsPort() == DEFAULT_HTTPS_PORT

    /** Internal data/blob/about resources are allowed; every network resource must be whitelisted. */
    fun isAllowedWebResource(uri: Uri): Boolean = when (uri.scheme?.lowercase(Locale.US)) {
        HTTPS_SCHEME -> isTrustedPage(uri) || isAllowedResourceHost(uri)
        "data" -> true
        "about" -> uri.toString() == "about:blank"
        "blob" -> uri.toString()
            .removePrefix("blob:")
            .let { runCatching { Uri.parse(it) }.getOrNull() }
            ?.let(::isTrustedPage) == true
        else -> false
    }

    fun sanitizedForDiagnostics(url: String?): String {
        if (url.isNullOrBlank()) return ""
        // Reuse the strict parser so userinfo, non-HTTPS schemes and malformed authorities can
        // never be copied into a support report even if a build variable was misconfigured.
        val uri = parseHttpsUri(url) ?: return "invalid-url"
        return uri.buildUpon().clearQuery().fragment(null).build().toString().take(MAX_DIAGNOSTIC_URL_LENGTH)
    }

    private fun parseHttpsUri(value: String): Uri? {
        val uri = runCatching { Uri.parse(value.trim()) }.getOrNull() ?: return null
        if (!uri.scheme.equals(HTTPS_SCHEME, ignoreCase = true)) return null
        if (uri.isOpaque || uri.host?.toAsciiHost() == null) return null
        if (uri.encodedAuthority?.contains('@') == true || uri.effectiveHttpsPort() == null) return null
        return uri.normalizeScheme()
    }

    private fun parseHttpsOrigin(value: String): Uri? {
        val uri = parseHttpsUri(value) ?: return null
        if (
            uri.encodedPath?.takeIf { it.isNotEmpty() && it != "/" } != null ||
            uri.encodedQuery != null ||
            uri.encodedFragment != null
        ) {
            return null
        }
        return uri
    }

    private fun hasSameOrigin(left: Uri, right: Uri): Boolean =
        left.host?.toAsciiHost() == right.host?.toAsciiHost() &&
            left.effectiveHttpsPort() == right.effectiveHttpsPort()

    private fun isAllowedResourceHost(uri: Uri): Boolean {
        if (!uri.scheme.equals(HTTPS_SCHEME, ignoreCase = true)) return false
        if (uri.isOpaque || uri.encodedAuthority?.contains('@') == true) return false
        val host = uri.host?.toAsciiHost() ?: return false
        return host in allowedResourceHosts && uri.effectiveHttpsPort() == DEFAULT_HTTPS_PORT
    }

    private fun Uri.effectiveHttpsPort(): Int? = when {
        port == -1 -> DEFAULT_HTTPS_PORT
        port in 1..65535 -> port
        else -> null
    }

    private fun String.toAsciiHost(): String? = runCatching {
        IDN.toASCII(trim().trimEnd('.'), IDN.USE_STD3_ASCII_RULES).lowercase(Locale.US)
    }.getOrNull()?.takeIf { it.isNotBlank() && it.length <= MAX_HOST_LENGTH }

    private companion object {
        const val HTTPS_SCHEME = "https"
        const val DEFAULT_HTTPS_PORT = 443
        const val MAX_HOST_LENGTH = 253
        const val MAX_DIAGNOSTIC_URL_LENGTH = 512
    }
}
