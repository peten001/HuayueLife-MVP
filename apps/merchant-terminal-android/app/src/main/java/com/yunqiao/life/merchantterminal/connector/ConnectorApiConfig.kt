package com.yunqiao.life.merchantterminal.connector

import android.net.Uri
import com.yunqiao.life.merchantterminal.BuildConfig

/** Central HTTPS-only endpoint for the existing merchant printing connector API. */
object ConnectorApiConfig {
    val baseUri: Uri? by lazy {
        runCatching { Uri.parse(BuildConfig.CONNECTOR_API_BASE_URL.trim()) }
            .getOrNull()
            ?.takeIf { uri ->
                uri.scheme.equals("https", ignoreCase = true) &&
                    !uri.host.isNullOrBlank() &&
                    uri.userInfo == null &&
                    uri.query == null &&
                    uri.fragment == null
            }
    }

    val isConfigured: Boolean get() = baseUri != null

    fun endpoint(relativePath: String): String {
        require(relativePath.startsWith('/') && !relativePath.startsWith("//")) {
            "Connector endpoint must be an absolute path without an authority."
        }
        require(!relativePath.contains('?') && !relativePath.contains('#')) {
            "Connector endpoint query and fragment are not allowed."
        }
        val base = baseUri ?: error("Connector API is not configured.")
        val basePath = base.path.orEmpty().trimEnd('/')
        return base.buildUpon().path(basePath + relativePath).build().toString()
    }

    fun sanitizedForDiagnostics(): String = baseUri?.let { uri ->
        uri.buildUpon().clearQuery().fragment(null).build().toString()
    } ?: "NOT_CONFIGURED"
}
