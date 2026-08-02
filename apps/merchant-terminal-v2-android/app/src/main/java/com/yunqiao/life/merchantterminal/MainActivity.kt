package com.yunqiao.life.merchantterminal

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.ComposeView
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.yunqiao.life.merchantterminal.presentation.PrinterDevicesController
import com.yunqiao.life.merchantterminal.presentation.PrinterDevicesEffect
import com.yunqiao.life.merchantterminal.presentation.toUiState
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothPermissionPolicy
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbPermissionController
import com.yunqiao.life.merchantterminal.recovery.V2RecoveryScheduler
import com.yunqiao.life.merchantterminal.security.MerchantSessionCoordinator
import com.yunqiao.life.merchantterminal.security.MerchantSessionProcessScope
import com.yunqiao.life.merchantterminal.security.MerchantWebSessionContract
import com.yunqiao.life.merchantterminal.security.MerchantWebSessionSnapshot
import com.yunqiao.life.merchantterminal.security.MerchantSessionStopReason
import com.yunqiao.life.merchantterminal.web.OriginPolicy
import com.yunqiao.life.merchantterminal.web.TerminalLoadError
import com.yunqiao.life.merchantterminal.web.TerminalLoadErrorType
import com.yunqiao.life.merchantterminal.web.TerminalWebChromeClient
import com.yunqiao.life.merchantterminal.web.TerminalWebView
import com.yunqiao.life.merchantterminal.web.TerminalWebViewClient
import com.yunqiao.life.merchantterminal.web.TrustedWebMessageBridge
import com.yunqiao.life.merchantterminal.ui.PrinterDevicesActions
import com.yunqiao.life.merchantterminal.ui.PrinterDevicesRoot
import com.yunqiao.life.merchantterminal.ui.PrinterTransportUi
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import kotlinx.coroutines.launch
import java.util.Locale

class MainActivity :
    ComponentActivity(),
    TerminalWebViewClient.Listener,
    TerminalWebChromeClient.Host {
    private val graph: TerminalGraph
        get() = (application as TerminalApplication).graph

    private val originPolicy by lazy(::OriginPolicy)
    private lateinit var root: FrameLayout
    private lateinit var overlay: ComposeView
    private var terminalWebView: TerminalWebView? = null
    private var terminalChromeClient: TerminalWebChromeClient? = null
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private lateinit var printerDevicesController: PrinterDevicesController
    private lateinit var merchantSessionCoordinator: MerchantSessionCoordinator
    private lateinit var usbPermissionController: UsbPermissionController
    private val usbInspector by lazy { UsbDeviceInspector(this) }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val values = if (result.resultCode == Activity.RESULT_OK) {
            result.data?.clipData?.let { clip ->
                (0 until clip.itemCount).map { clip.getItemAt(it).uri }.toTypedArray()
            } ?: result.data?.data?.let { arrayOf(it) }
        } else {
            null
        }
        fileChooserCallback?.onReceiveValue(values)
        fileChooserCallback = null
    }

    private val bluetoothPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.isNotEmpty() && grants.values.all { it }) {
            printerDevicesController.refresh()
        } else {
            printerDevicesController.onBluetoothPermissionDenied()
        }
    }

    private val bluetoothEnableLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            printerDevicesController.refresh()
        } else {
            printerDevicesController.onBluetoothEnableDeclined()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        configureFullscreen()
        root = FrameLayout(this)
        setContentView(root)
        printerDevicesController = PrinterDevicesController(
            context = this,
            repository = graph.printingRepository,
            credentialStore = graph.credentialStore,
            identityStore = graph.identityStore,
        )
        merchantSessionCoordinator = MerchantSessionCoordinator(
            tokenStore = graph.merchantSessionTokenStore,
            startConnector = {
                graph.sessionController.onMerchantAuthenticated(
                    requireNotNull(graph.merchantSessionTokenStore.read()),
                )
            },
            shutdown = { reason ->
                printerDevicesController.close()
                graph.merchantSessionTokenStore.clear()
                graph.sessionController.onMerchantSignedOut(reason)
            },
        )
        usbPermissionController = UsbPermissionController(
            activity = this,
            onPermissionResult = { _, _ -> printerDevicesController.refresh() },
            onDeviceAttached = { printerDevicesController.refresh() },
            onDeviceDetached = { printerDevicesController.refresh() },
        )
        createWebView()
        createOverlay()
        observeControllerEffects()
        installBackHandler()
        if (savedInstanceState == null) {
            openInitialPage()
        } else {
            terminalWebView?.restoreState(savedInstanceState)
        }
    }

    override fun onStart() {
        super.onStart()
        usbPermissionController.register()
    }

    override fun onStop() {
        usbPermissionController.unregister()
        terminalWebView?.flushSessionState()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
        if (graph.credentialStore.readCredential()?.isUsable() == true ||
            graph.merchantSessionTokenStore.hasCredential()
        ) {
            V2RecoveryScheduler.schedule(this, "activity-resumed")
        }
        observeMerchantSession()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        usbPermissionController.handlePermissionResult(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        terminalWebView?.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        terminalChromeClient?.destroyTransientWindows()
        terminalWebView?.let { webView ->
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.stopLoading()
            webView.destroy()
        }
        terminalWebView = null
        printerDevicesController.clear()
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onMainPageStarted(url: String) = Unit

    override fun onMainPageLoaded(url: String) {
        val webView = terminalWebView ?: return
        webView.evaluateJavascript(MerchantWebSessionContract.logoutObserverScript(), null)
        webView.evaluateJavascript(PRINTER_DEVICES_ENTRY_COMPAT_SCRIPT, null)
        webView.evaluateJavascript("(document.documentElement.lang || 'zh').slice(0,2)") { value ->
            applyWebLanguage(value.trim('"').lowercase(Locale.ROOT))
        }
        observeMerchantSession()
    }

    override fun onMainPageError(error: TerminalLoadError) {
        Toast.makeText(this, error.type.titleZh, Toast.LENGTH_LONG).show()
    }

    override fun onExternalHttpsRequested(uri: Uri) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    override fun onDialRequested(uri: Uri) {
        runCatching { startActivity(Intent(Intent.ACTION_DIAL, uri)) }
    }

    override fun onNavigationBlocked(uri: Uri?) = Unit

    override fun onRendererGone(view: WebView, didCrash: Boolean) {
        if (view !== terminalWebView) return
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        terminalWebView = null
        terminalChromeClient = null
        createWebView()
        openInitialPage()
    }

    override fun onProgressChanged(progress: Int) = Unit

    override fun openFileChooser(
        acceptTypes: Array<String>,
        allowMultiple: Boolean,
        callback: ValueCallback<Array<Uri>>,
    ) {
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = callback
        val normalizedTypes = acceptTypes
            .map(String::trim)
            .filter { it.matches(MIME_TYPE) }
            .distinct()
            .take(20)
        val chooserIntent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            type = normalizedTypes.singleOrNull() ?: "*/*"
            if (normalizedTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, normalizedTypes.toTypedArray())
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
        }
        runCatching { fileChooserLauncher.launch(chooserIntent) }
            .onFailure {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = null
            }
    }

    override fun onNewWindowUrl(url: String) {
        val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
        when {
            originPolicy.isTrustedPage(uri) -> terminalWebView?.loadUrl(uri.toString())
            originPolicy.isSafeExternalHttps(uri) -> onExternalHttpsRequested(uri)
        }
    }

    override fun onPopupBlocked() = Unit

    private fun createWebView() {
        if (terminalWebView != null) return
        val webView = TerminalWebView(this)
        val chromeClient = TerminalWebChromeClient(this, originPolicy, this)
        webView.webViewClient = TerminalWebViewClient(originPolicy, this)
        webView.webChromeClient = chromeClient
        TrustedWebMessageBridge(
            originPolicy = originPolicy,
            onSignedOut = { reason ->
                val sequence = merchantSessionCoordinator.beginObservation()
                MerchantSessionProcessScope.launch {
                    merchantSessionCoordinator.applyObservation(
                        sequence,
                        MerchantWebSessionSnapshot.SignedOut(reason),
                    )
                }
            },
            onSessionChanged = {
                runOnUiThread(::observeMerchantSession)
            },
            onLanguageChanged = { language -> runOnUiThread { applyWebLanguage(language) } },
            onOpenPrinterDevices = {
                printerDevicesController.open()
            },
        ).install(webView)
        root.addView(
            webView,
            0,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        terminalWebView = webView
        terminalChromeClient = chromeClient
    }

    private fun createOverlay() {
        overlay = ComposeView(this).apply {
            visibility = View.VISIBLE
            setContent {
                val state by printerDevicesController.state.collectAsStateWithLifecycle()
                if (state.visible) {
                    PrinterDevicesRoot(
                        state = state.toUiState(),
                        actions = PrinterDevicesActions(
                            onBack = printerDevicesController::back,
                            onClose = printerDevicesController::close,
                            onAddPrinter = printerDevicesController::startAdd,
                            onManagePrinter = printerDevicesController::openBinding,
                            onSelectTransport = { printerDevicesController.selectTransport(it.toCore()) },
                            onContinueAdd = printerDevicesController::continueCurrentFlow,
                            onRefresh = printerDevicesController::refresh,
                            onRetry = printerDevicesController::refresh,
                            onSelectLanPrinter = printerDevicesController::selectCandidate,
                            onManualLanAddress = printerDevicesController::beginManualLanEntry,
                            onManualLanAddressChanged = printerDevicesController::setManualLanAddress,
                            onSelectBluetoothPrinter = printerDevicesController::selectCandidate,
                            onPairBluetoothPrinter = printerDevicesController::pairBluetooth,
                            onPrinterNameChanged = printerDevicesController::setPrinterName,
                            onPaperWidthChanged = printerDevicesController::setPaperWidth,
                            onTestPrinter = printerDevicesController::test,
                            onSavePrinter = printerDevicesController::saveDraft,
                            onAddAnother = printerDevicesController::startAdd,
                            onFinish = printerDevicesController::finishAdd,
                            onRequestEditName = printerDevicesController::beginEditName,
                            onConfirmEditName = printerDevicesController::confirmEditName,
                            onDismissEditName = printerDevicesController::dismissEditName,
                            onRequestArchive = printerDevicesController::requestArchive,
                            onConfirmArchive = printerDevicesController::confirmArchive,
                            onDismissArchive = printerDevicesController::dismissArchive,
                        ),
                    )
                }
            }
        }
        root.addView(
            overlay,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
    }

    private fun observeControllerEffects() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                printerDevicesController.effects.collect { effect ->
                    when (effect) {
                        is PrinterDevicesEffect.RequestUsbPermission -> {
                            usbInspector.findDevice(effect.deviceName)?.let {
                                usbPermissionController.requestPermission(it)
                            }
                        }
                        PrinterDevicesEffect.RequestBluetoothPermissions -> {
                            bluetoothPermissionLauncher.launch(
                                BluetoothPermissionPolicy(this@MainActivity).runtimePermissions(),
                            )
                        }
                        PrinterDevicesEffect.RequestBluetoothEnable -> {
                            bluetoothEnableLauncher.launch(
                                Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE),
                            )
                        }
                    }
                }
            }
        }
    }

    private fun observeMerchantSession() {
        val webView = terminalWebView ?: return
        if (!originPolicy.isTrustedPage(webView.url)) {
            com.yunqiao.life.merchantterminal.runtime.StartupTrace.event("WEB_SESSION_REJECTED")
            return
        }
        val sequence = merchantSessionCoordinator.beginObservation()
        webView.evaluateJavascript(MerchantWebSessionContract.snapshotScript()) { encoded ->
            val snapshot = MerchantWebSessionContract.decodeSnapshot(encoded)
            when (snapshot) {
                is MerchantWebSessionSnapshot.Authenticated ->
                    com.yunqiao.life.merchantterminal.runtime.StartupTrace.event("WEB_SESSION_RECEIVED")
                else -> com.yunqiao.life.merchantterminal.runtime.StartupTrace.event("WEB_SESSION_REJECTED")
            }
            lifecycleScope.launch {
                merchantSessionCoordinator.applyObservation(sequence, snapshot)
            }
        }
    }

    private fun applyWebLanguage(language: String) {
        val locale = when (language) {
            "vi" -> Locale("vi", "VN")
            "en" -> Locale.ENGLISH
            else -> Locale.SIMPLIFIED_CHINESE
        }
        val configuration = resources.configuration
        configuration.setLocale(locale)
        resources.updateConfiguration(configuration, resources.displayMetrics)
    }

    private fun openInitialPage() {
        if (!originPolicy.isConfigured || originPolicy.startUri == null) {
            onMainPageError(TerminalLoadError(TerminalLoadErrorType.CONFIGURATION))
            return
        }
        if (!isNetworkAvailable()) {
            onMainPageError(TerminalLoadError(TerminalLoadErrorType.NO_NETWORK))
        }
        terminalWebView?.loadUrl(originPolicy.startUrl)
    }

    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    when {
                        printerDevicesController.state.value.visible ->
                            printerDevicesController.back()
                        terminalWebView?.canGoBack() == true -> terminalWebView?.goBack()
                        else -> finish()
                    }
                }
            },
        )
    }

    private fun configureFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()
    }

    private fun hideSystemBars() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private companion object {
        const val PRINTER_DEVICES_ENTRY_COMPAT_SCRIPT = """
            (function(){
              if(window.__yunqiaoPrinterEntryCompat){return;}
              window.__yunqiaoPrinterEntryCompat=true;
              var add=function(){
                var pop=document.querySelector('.account-menu__popover');
                if(!pop||pop.querySelector('[data-testid="printer-devices-entry"]'))return;
                var language=pop.querySelector('select');
                var copy=language&&language.value==='vi'?'Máy in và thiết bị':language&&language.value==='en'?'Printers & Devices':'打印机与设备';
                var button=document.createElement('button');
                button.type='button';
                button.setAttribute('data-testid','printer-devices-entry');
                button.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg><span>'+copy+'</span><span aria-hidden="true" style="margin-left:auto">›</span>';
                button.addEventListener('click',function(){
                  if(window.YunQiaoMerchantTerminal&&typeof window.YunQiaoMerchantTerminal.postMessage==='function'){
                    window.YunQiaoMerchantTerminal.postMessage('{"type":"OPEN_PRINTER_DEVICES","version":1}');
                  }
                });
                var logout=Array.prototype.find.call(pop.querySelectorAll('button'),function(item){return /退出登录|Đăng xuất|Log out/.test(item.textContent||'');});
                if(logout)pop.insertBefore(button,logout);else pop.appendChild(button);
              };
              new MutationObserver(add).observe(document.documentElement,{childList:true,subtree:true});
              add();
            })();
        """
        val MIME_TYPE = Regex("^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+*-]+$")
    }

    private fun isNetworkAvailable(): Boolean =
        getSystemService(ConnectivityManager::class.java)?.activeNetwork != null

}

private fun PrinterTransportUi.toCore(): PrinterTransport = PrinterTransport.valueOf(name)
