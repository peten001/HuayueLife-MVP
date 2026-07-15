package com.yunqiao.life.merchantterminal

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.KeyEvent
import android.view.Menu
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebView
import android.webkit.MimeTypeMap
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.yunqiao.life.merchantterminal.data.TerminalSettings
import com.yunqiao.life.merchantterminal.databinding.ActivityMainBinding
import com.yunqiao.life.merchantterminal.diagnostics.DeviceDiagnostics
import com.yunqiao.life.merchantterminal.diagnostics.DiagnosticsActivity
import com.yunqiao.life.merchantterminal.diagnostics.UsbPrinterDiagnosticsActivity
import com.yunqiao.life.merchantterminal.web.OriginPolicy
import com.yunqiao.life.merchantterminal.web.TerminalLoadError
import com.yunqiao.life.merchantterminal.web.TerminalLoadErrorType
import com.yunqiao.life.merchantterminal.web.TerminalWebChromeClient
import com.yunqiao.life.merchantterminal.web.TerminalWebView
import com.yunqiao.life.merchantterminal.web.TerminalWebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

class MainActivity : AppCompatActivity(), TerminalWebViewClient.Listener, TerminalWebChromeClient.Host {

    private lateinit var binding: ActivityMainBinding
    private lateinit var originPolicy: OriginPolicy
    private lateinit var terminalSettings: TerminalSettings
    private lateinit var connectivityManager: ConnectivityManager

    private var terminalWebView: TerminalWebView? = null
    private var terminalChromeClient: TerminalWebChromeClient? = null
    private var currentError: TerminalLoadError? = null
    private var lastTrustedUrl: String? = null
    private var pendingFileChooser: PendingFileChooser? = null
    private var hasLoadedPage = false
    private var networkCallbackRegistered = false
    private var lastBackPressAt = 0L

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val request = pendingFileChooser ?: return@registerForActivityResult
        if (result.resultCode != Activity.RESULT_OK) {
            completeFileChooser(request, null)
            return@registerForActivityResult
        }

        val uris = buildList {
            result.data?.clipData?.let { clipData ->
                for (index in 0 until clipData.itemCount) {
                    clipData.getItemAt(index).uri?.let(::add)
                }
            }
            result.data?.data?.let(::add)
        }.distinct().toTypedArray()
        val maximumSelection = if (request.allowMultiple) MAX_FILE_SELECTION_COUNT else 1
        if (uris.isEmpty() || uris.size > maximumSelection) {
            completeFileChooser(request, null)
            return@registerForActivityResult
        }

        lifecycleScope.launch {
            val isValid = withContext(Dispatchers.IO) {
                uris.all { uri -> isReadableAcceptedContentUri(uri, request.acceptedMimeTypes) }
            }
            completeFileChooser(request, uris.takeIf { isValid })
        }
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            binding.root.postDelayed({
                if (
                    currentError?.type == TerminalLoadErrorType.NO_NETWORK &&
                    lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) &&
                    isNetworkAvailable()
                ) {
                    reloadCurrentPage()
                }
            }, NETWORK_RECOVERY_DEBOUNCE_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        originPolicy = OriginPolicy()
        terminalSettings = TerminalSettings(applicationContext)
        connectivityManager = getSystemService(ConnectivityManager::class.java)
        configureWindowForTerminal()
        configureErrorState()
        configureTerminalMenu()
        configureSwipeRefresh()
        configureBackNavigation()
        observeTerminalSettings()
        createWebView()

        val hadRestorableError = savedInstanceState?.getBoolean(KEY_HAD_ERROR) == true
        val restored = if (hadRestorableError) {
            false
        } else {
            savedInstanceState
                ?.getBundle(KEY_WEBVIEW_STATE)
                ?.let { terminalWebView?.restoreState(it) }
                ?.let { true }
                ?: false
        }

        if (restored) {
            binding.startupState.isVisible = false
            hasLoadedPage = true
        } else {
            openInitialPage()
        }
    }

    override fun onStart() {
        super.onStart()
        registerNetworkCallback()
    }

    override fun onResume() {
        super.onResume()
        terminalWebView?.onResume()
        enterImmersiveMode()

        when {
            currentError?.type == TerminalLoadErrorType.NO_NETWORK && isNetworkAvailable() -> {
                // This is an error-specific recovery, not an unconditional foreground refresh.
                reloadCurrentPage()
            }
            terminalWebView?.url == null && currentError == null && originPolicy.isConfigured -> {
                openInitialPage()
            }
        }
    }

    override fun onPause() {
        terminalWebView?.flushSessionState()
        terminalWebView?.onPause()
        super.onPause()
    }

    override fun onStop() {
        unregisterNetworkCallback()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(KEY_HAD_ERROR, currentError != null)
        terminalWebView?.let { webView ->
            val webViewState = Bundle()
            webView.saveState(webViewState)
            outState.putBundle(KEY_WEBVIEW_STATE, webViewState)
        }
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        cancelPendingFileChooser()
        terminalChromeClient?.destroyTransientWindows()
        terminalChromeClient = null
        terminalWebView?.let(::destroyWebView)
        terminalWebView = null
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        val isRefreshShortcut = keyCode == KeyEvent.KEYCODE_F5 ||
            (keyCode == KeyEvent.KEYCODE_R && event.isCtrlPressed)
        if (isRefreshShortcut) {
            reloadCurrentPage()
            return true
        }
        return super.onKeyUp(keyCode, event)
    }

    override fun onMainPageStarted(url: String) {
        if (originPolicy.isTrustedPage(url)) {
            lastTrustedUrl = url
        }
        currentError = null
        binding.errorState.hide()
        binding.pageProgress.isVisible = true
        lifecycleScope.launch {
            terminalSettings.recordPageLoadStarted(originPolicy.sanitizedForDiagnostics(url))
        }
    }

    override fun onMainPageLoaded(url: String) {
        val sanitizedUrl = originPolicy.sanitizedForDiagnostics(url)
        if (originPolicy.isTrustedPage(url)) lastTrustedUrl = url
        currentError = null
        hasLoadedPage = true
        binding.startupState.isVisible = false
        binding.errorState.hide()
        binding.pageProgress.isVisible = false
        binding.swipeRefresh.isRefreshing = false
        binding.swipeRefresh.isEnabled = true
        DeviceDiagnostics.recordWebLoadSuccess(applicationContext)
        lifecycleScope.launch {
            terminalSettings.recordPageLoadSuccess(sanitizedUrl)
        }
    }

    override fun onMainPageError(error: TerminalLoadError) {
        val classifiedError = if (!isNetworkAvailable()) {
            error.copy(type = TerminalLoadErrorType.NO_NETWORK)
        } else {
            error
        }
        showError(classifiedError)
    }

    override fun onExternalHttpsRequested(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, R.string.external_link_blocked, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onNavigationBlocked(uri: Uri?) {
        Toast.makeText(this, R.string.external_link_blocked, Toast.LENGTH_SHORT).show()
    }

    override fun onRendererGone(view: WebView, didCrash: Boolean) {
        if (terminalWebView === view) {
            binding.webContainer.removeView(view)
            terminalWebView = null
            terminalChromeClient?.destroyTransientWindows()
            terminalChromeClient = null
            view.destroy()
            createWebView()
        }
        binding.swipeRefresh.isRefreshing = false
        showError(
            TerminalLoadError(
                type = TerminalLoadErrorType.RENDERER_GONE,
                detail = if (didCrash) "renderer-crashed" else "renderer-reclaimed",
            ),
        )
    }

    override fun onProgressChanged(progress: Int) {
        binding.pageProgress.progress = progress
        binding.pageProgress.isVisible = progress in 1..99 && currentError == null
    }

    override fun openFileChooser(
        acceptTypes: Array<String>,
        allowMultiple: Boolean,
        callback: ValueCallback<Array<Uri>>,
    ) {
        cancelPendingFileChooser()
        val declaredAcceptValues = acceptTypes
            .asSequence()
            .flatMap { it.split(',').asSequence() }
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .take(MAX_ACCEPTED_MIME_TYPES)
            .toList()
        val mimeTypes = declaredAcceptValues
            .mapNotNull(::normalizeAcceptedMimeType)
            .distinct()
        if (declaredAcceptValues.isNotEmpty() && mimeTypes.isEmpty()) {
            callback.onReceiveValue(null)
            return
        }
        val effectiveMimeTypes = mimeTypes.ifEmpty { listOf(ANY_MIME_TYPE) }
        val request = PendingFileChooser(
            callback = callback,
            acceptedMimeTypes = effectiveMimeTypes.toSet(),
            allowMultiple = allowMultiple,
        )
        pendingFileChooser = request

        val chooserIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            type = effectiveMimeTypes.singleOrNull() ?: ANY_MIME_TYPE
            if (effectiveMimeTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, effectiveMimeTypes.toTypedArray())
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
        }
        runCatching { fileChooserLauncher.launch(chooserIntent) }
            .onFailure {
                completeFileChooser(request, null)
            }
    }

    override fun onNewWindowUrl(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull()
        when {
            uri == null -> onPopupBlocked()
            originPolicy.isTrustedPage(uri) -> terminalWebView?.loadUrl(uri.toString())
            originPolicy.isSafeExternalHttps(uri) -> onExternalHttpsRequested(uri)
            else -> onPopupBlocked()
        }
    }

    override fun onPopupBlocked() {
        Toast.makeText(this, R.string.popup_blocked, Toast.LENGTH_SHORT).show()
    }

    private fun createWebView() {
        if (terminalWebView != null) return
        val webView = TerminalWebView(this)
        val chromeClient = TerminalWebChromeClient(this, originPolicy, this)
        webView.webViewClient = TerminalWebViewClient(originPolicy, this)
        webView.webChromeClient = chromeClient
        webView.setDownloadListener { url, _, _, _, _ ->
            val uri = runCatching { Uri.parse(url) }.getOrNull()
            when {
                uri == null -> onNavigationBlocked(null)
                uri.scheme?.equals("blob", ignoreCase = true) == true -> {
                    Toast.makeText(
                        this,
                        R.string.blob_download_unavailable,
                        Toast.LENGTH_LONG,
                    ).show()
                }
                originPolicy.isSafeExternalHttps(uri) -> onExternalHttpsRequested(uri)
                else -> onNavigationBlocked(uri)
            }
        }
        binding.webContainer.addView(
            webView,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        terminalChromeClient = chromeClient
        terminalWebView = webView
    }

    private fun openInitialPage() {
        if (!originPolicy.isConfigured || originPolicy.startUri == null) {
            showError(TerminalLoadError(TerminalLoadErrorType.CONFIGURATION))
            return
        }
        if (!isNetworkAvailable()) {
            showError(TerminalLoadError(TerminalLoadErrorType.NO_NETWORK))
            return
        }
        binding.startupState.isVisible = !hasLoadedPage
        terminalWebView?.loadUrl(originPolicy.startUrl)
    }

    private fun reloadCurrentPage() {
        if (!originPolicy.isConfigured) {
            showError(TerminalLoadError(TerminalLoadErrorType.CONFIGURATION))
            return
        }
        if (!isNetworkAvailable()) {
            showError(TerminalLoadError(TerminalLoadErrorType.NO_NETWORK))
            return
        }
        if (terminalWebView == null) createWebView()
        currentError = null
        binding.errorState.hide()
        binding.swipeRefresh.isEnabled = true
        binding.startupState.isVisible = !hasLoadedPage
        val url = lastTrustedUrl
            ?.takeIf { originPolicy.isTrustedPage(it) }
            ?: originPolicy.startUrl
        terminalWebView?.loadUrl(url)
    }

    private fun showError(error: TerminalLoadError) {
        currentError = error
        binding.startupState.isVisible = false
        binding.pageProgress.isVisible = false
        binding.swipeRefresh.isRefreshing = false
        binding.swipeRefresh.isEnabled = false
        binding.errorState.show(error)
        DeviceDiagnostics.recordWebLoadError(applicationContext, error.diagnosticCode)
        lifecycleScope.launch {
            terminalSettings.recordPageLoadError(
                code = error.type.code,
                detail = error.detail,
                url = error.failingUrl,
            )
        }
    }

    private fun configureErrorState() {
        binding.errorState.onRetry = ::reloadCurrentPage
        binding.errorState.onOpenNetworkSettings = ::openNetworkSettings
        binding.errorState.onOpenDiagnostics = {
            startActivity(Intent(this, DiagnosticsActivity::class.java))
        }
    }

    private fun configureTerminalMenu() {
        binding.terminalMenuButton.setOnClickListener { anchor ->
            PopupMenu(this, anchor).apply {
                menu.add(Menu.NONE, MENU_CASHIER, Menu.NONE, R.string.menu_cashier)
                menu.add(Menu.NONE, MENU_DEVICE_DIAGNOSTICS, Menu.NONE, R.string.menu_device_diagnostics)
                menu.add(Menu.NONE, MENU_USB_DIAGNOSTICS, Menu.NONE, R.string.menu_usb_diagnostics)
                setOnMenuItemClickListener { item ->
                    when (item.itemId) {
                        MENU_CASHIER -> {
                            reloadCurrentPage()
                            true
                        }
                        MENU_DEVICE_DIAGNOSTICS -> {
                            startActivity(Intent(this@MainActivity, DiagnosticsActivity::class.java))
                            true
                        }
                        MENU_USB_DIAGNOSTICS -> {
                            startActivity(
                                Intent(
                                    this@MainActivity,
                                    UsbPrinterDiagnosticsActivity::class.java,
                                ),
                            )
                            true
                        }
                        else -> false
                    }
                }
                show()
            }
        }
    }

    private fun configureSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeResources(R.color.terminal_primary)
        binding.swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            terminalWebView?.canScrollVertically(-1) == true
        }
        binding.swipeRefresh.setOnRefreshListener(::reloadCurrentPage)
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val webView = terminalWebView
                    if (webView?.canGoBack() == true) {
                        currentError = null
                        binding.errorState.hide()
                        webView.goBack()
                        return
                    }

                    val now = SystemClock.elapsedRealtime()
                    if (now - lastBackPressAt <= BACK_TO_EXIT_WINDOW_MS) {
                        finish()
                    } else {
                        lastBackPressAt = now
                        Toast.makeText(
                            this@MainActivity,
                            R.string.exit_confirmation,
                            Toast.LENGTH_SHORT,
                        ).show()
                    }
                }
            },
        )
    }

    private fun configureWindowForTerminal() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val imeBottom = if (insets.isVisible(WindowInsetsCompat.Type.ime())) {
                insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            } else {
                0
            }
            view.setPadding(0, 0, 0, imeBottom)
            insets
        }
        enterImmersiveMode()
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun observeTerminalSettings() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                terminalSettings.values.collect { settings ->
                    if (settings.keepScreenOn) {
                        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else {
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                }
            }
        }
    }

    private fun openNetworkSettings() {
        val primary = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY)
        } else {
            Intent(Settings.ACTION_WIRELESS_SETTINGS)
        }
        val launched = runCatching { startActivity(primary) }.isSuccess
        if (!launched) runCatching { startActivity(Intent(Settings.ACTION_SETTINGS)) }
    }

    private fun registerNetworkCallback() {
        if (networkCallbackRegistered) return
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
            .onSuccess { networkCallbackRegistered = true }
    }

    private fun unregisterNetworkCallback() {
        if (!networkCallbackRegistered) return
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        networkCallbackRegistered = false
    }

    private fun isNetworkAvailable(): Boolean {
        val activeNetwork = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(activeNetwork) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun destroyWebView(webView: TerminalWebView) {
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = android.webkit.WebViewClient()
        webView.destroy()
    }

    private fun normalizeAcceptedMimeType(value: String): String? {
        val normalized = value
            .substringBefore(';')
            .trim()
            .lowercase(Locale.US)
        if (normalized.startsWith('.') && normalized.length > 1) {
            val extension = normalized.removePrefix(".")
            if (!MIME_TOKEN.matches(extension)) return null
            return MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(extension)
                ?.let(::normalizeAcceptedMimeType)
        }
        if (normalized == ANY_MIME_TYPE) return normalized
        if (normalized.length !in 3..127 || normalized.any(Char::isWhitespace)) return null
        val parts = normalized.split('/')
        if (parts.size != 2 || parts[0].isBlank() || parts[1].isBlank()) return null
        if (!MIME_TOKEN.matches(parts[0])) return null
        if (parts[1] != "*" && !MIME_TOKEN.matches(parts[1])) return null
        return normalized
    }

    private fun isReadableAcceptedContentUri(uri: Uri, acceptedMimeTypes: Set<String>): Boolean {
        if (!uri.scheme.equals("content", ignoreCase = true)) return false
        val actualMimeType = runCatching { contentResolver.getType(uri) }
            .getOrNull()
            ?.let(::normalizeAcceptedMimeType)
        val mimeAccepted = if (actualMimeType == null) {
            ANY_MIME_TYPE in acceptedMimeTypes
        } else {
            acceptedMimeTypes.any { expected -> mimeTypeMatches(expected, actualMimeType) }
        }
        if (!mimeAccepted) return false

        return runCatching {
            contentResolver.openFileDescriptor(uri, "r")?.use { descriptor ->
                descriptor.fileDescriptor.valid()
            } == true
        }.getOrDefault(false)
    }

    private fun mimeTypeMatches(expected: String, actual: String): Boolean {
        if (expected == ANY_MIME_TYPE || expected == actual) return true
        val expectedParts = expected.split('/')
        val actualParts = actual.split('/')
        return expectedParts.size == 2 &&
            actualParts.size == 2 &&
            expectedParts[0] == actualParts[0] &&
            expectedParts[1] == "*"
    }

    private fun completeFileChooser(request: PendingFileChooser, uris: Array<Uri>?) {
        if (pendingFileChooser !== request) return
        pendingFileChooser = null
        request.callback.onReceiveValue(uris)
    }

    private fun cancelPendingFileChooser() {
        val request = pendingFileChooser ?: return
        pendingFileChooser = null
        request.callback.onReceiveValue(null)
    }

    private data class PendingFileChooser(
        val callback: ValueCallback<Array<Uri>>,
        val acceptedMimeTypes: Set<String>,
        val allowMultiple: Boolean,
    )

    private companion object {
        const val KEY_WEBVIEW_STATE = "terminal_webview_state"
        const val KEY_HAD_ERROR = "terminal_had_error"
        const val BACK_TO_EXIT_WINDOW_MS = 2_000L
        const val NETWORK_RECOVERY_DEBOUNCE_MS = 700L
        const val MAX_FILE_SELECTION_COUNT = 10
        const val MAX_ACCEPTED_MIME_TYPES = 32
        const val MENU_CASHIER = 1
        const val MENU_DEVICE_DIAGNOSTICS = 2
        const val MENU_USB_DIAGNOSTICS = 3
        const val ANY_MIME_TYPE = "*/*"
        val MIME_TOKEN = Regex("^[a-z0-9][a-z0-9!#$&^_.+\\-]*$")
    }
}
