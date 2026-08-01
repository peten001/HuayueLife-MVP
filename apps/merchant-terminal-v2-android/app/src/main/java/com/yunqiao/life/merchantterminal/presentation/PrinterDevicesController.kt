package com.yunqiao.life.merchantterminal.presentation

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.model.BindingSyncStatus
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.LocalTransportConfig
import com.yunqiao.life.merchantterminal.model.PhysicalStatus
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.model.StatusSource
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.LocalTransportExecutor
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothClassicDiscovery
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothDiscoveryState
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.lan.LanPrinterDiscovery
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.storage.PrintingRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.last
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Instant
import java.util.UUID

enum class PrinterDevicesCoreRoute {
    OVERVIEW,
    CONNECTION_TYPE,
    LAN_DISCOVERY,
    LAN_SUCCESS,
    USB_SETUP,
    BLUETOOTH_SETUP,
    PRINTER_DETAIL,
}

enum class PrinterOperation {
    IDLE,
    DISCOVERING,
    CONNECTING,
    SYNCING,
    TESTING,
    SUCCESS,
    FAILURE,
    UNCERTAIN,
    RECOVERING,
    ARCHIVED,
}

data class PrinterCandidateCore(
    val identity: String,
    val displayName: String,
    val transport: PrinterTransport,
    val endpoint: String,
    val paired: Boolean = false,
    val available: Boolean = true,
    val config: LocalTransportConfig,
)

data class PrinterDevicesCoreState(
    val visible: Boolean = false,
    val route: PrinterDevicesCoreRoute = PrinterDevicesCoreRoute.OVERVIEW,
    val bindings: List<LocalPrinterBinding> = emptyList(),
    val selectedBindingId: String? = null,
    val selectedTransport: PrinterTransport = PrinterTransport.LAN,
    val candidates: List<PrinterCandidateCore> = emptyList(),
    val selectedCandidateId: String? = null,
    val bluetoothDiscoveryState: BluetoothDiscoveryState = BluetoothDiscoveryState.EMPTY,
    val manualLanEntryVisible: Boolean = false,
    val manualLanHost: String = "",
    val manualLanPort: Int = 9_100,
    val serviceRunning: Boolean = false,
    val terminalAuthenticated: Boolean = false,
    val operation: PrinterOperation = PrinterOperation.IDLE,
    val printerNameDraft: String = "",
    val paperWidth: PaperWidth = PaperWidth.MM_80,
    val archiveConfirmationVisible: Boolean = false,
    val nameEditVisible: Boolean = false,
    val userMessage: String? = null,
)

sealed interface PrinterDevicesEffect {
    data class RequestUsbPermission(val deviceName: String) : PrinterDevicesEffect
    data object RequestBluetoothPermissions : PrinterDevicesEffect
    data object RequestBluetoothEnable : PrinterDevicesEffect
}

class PrinterDevicesController(
    context: Context,
    private val repository: PrintingRepository,
    private val credentialStore: V2CredentialStore,
    private val identityStore: TerminalIdentityStore,
    private val transportExecutor: LocalTransportExecutor = LocalTransportExecutor(context),
    private val usbInspector: UsbDeviceInspector = UsbDeviceInspector(context),
    private val lanDiscovery: LanPrinterDiscovery = LanPrinterDiscovery(),
    private val bluetoothDiscovery: BluetoothClassicDiscovery = BluetoothClassicDiscovery(context),
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val applicationContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val mutableState = MutableStateFlow(PrinterDevicesCoreState())
    val state: StateFlow<PrinterDevicesCoreState> = mutableState.asStateFlow()
    private val mutableEffects = MutableSharedFlow<PrinterDevicesEffect>(extraBufferCapacity = 4)
    val effects = mutableEffects.asSharedFlow()
    private var bindingObservation: Job? = null
    private var draftBindingId = UUID.randomUUID().toString()
    private var draftPhysicalStatus = PhysicalStatus.UNKNOWN
    private var draftLastConnectedAt: Long? = null
    private var draftLastTestedAt: Long? = null

    init {
        scope.launch {
            TerminalRuntime.state.collectLatest { runtime ->
                mutableState.value = mutableState.value.copy(
                    serviceRunning = runtime.status in setOf(
                        ConnectorRuntimeStatus.STARTING,
                        ConnectorRuntimeStatus.ONLINE,
                        ConnectorRuntimeStatus.RUNNING,
                        ConnectorRuntimeStatus.DEGRADED,
                    ),
                    terminalAuthenticated = runtime.merchantId != null,
                )
                observeMerchant(runtime.merchantId)
            }
        }
    }

    fun open() {
        mutableState.value = mutableState.value.copy(
            visible = true,
            route = PrinterDevicesCoreRoute.OVERVIEW,
            userMessage = null,
        )
    }

    fun close() {
        mutableState.value = mutableState.value.copy(visible = false)
    }

    fun back() {
        if (mutableState.value.archiveConfirmationVisible) {
            dismissArchive()
            return
        }
        if (mutableState.value.nameEditVisible) {
            dismissEditName()
            return
        }
        val previous = when (mutableState.value.route) {
            PrinterDevicesCoreRoute.OVERVIEW -> {
                close()
                return
            }
            PrinterDevicesCoreRoute.CONNECTION_TYPE,
            PrinterDevicesCoreRoute.PRINTER_DETAIL,
            -> PrinterDevicesCoreRoute.OVERVIEW
            PrinterDevicesCoreRoute.LAN_DISCOVERY,
            PrinterDevicesCoreRoute.USB_SETUP,
            PrinterDevicesCoreRoute.BLUETOOTH_SETUP,
            -> PrinterDevicesCoreRoute.CONNECTION_TYPE
            PrinterDevicesCoreRoute.LAN_SUCCESS -> PrinterDevicesCoreRoute.OVERVIEW
        }
        mutableState.value = mutableState.value.copy(route = previous, userMessage = null)
    }

    fun startAdd() {
        draftBindingId = UUID.randomUUID().toString()
        draftPhysicalStatus = PhysicalStatus.UNKNOWN
        draftLastConnectedAt = null
        draftLastTestedAt = null
        mutableState.value = mutableState.value.copy(
            route = PrinterDevicesCoreRoute.CONNECTION_TYPE,
            candidates = emptyList(),
            selectedCandidateId = null,
            manualLanEntryVisible = false,
            manualLanHost = "",
            manualLanPort = 9_100,
            printerNameDraft = "",
            operation = PrinterOperation.IDLE,
        )
    }

    fun selectTransport(transport: PrinterTransport) {
        mutableState.value = mutableState.value.copy(selectedTransport = transport)
    }

    fun continueAdd() {
        mutableState.value = mutableState.value.copy(
            route = when (mutableState.value.selectedTransport) {
                PrinterTransport.USB -> PrinterDevicesCoreRoute.USB_SETUP
                PrinterTransport.LAN -> PrinterDevicesCoreRoute.LAN_DISCOVERY
                PrinterTransport.BLUETOOTH -> PrinterDevicesCoreRoute.BLUETOOTH_SETUP
            },
        )
        refresh()
    }

    fun refresh() {
        scope.launch {
            mutableState.value = mutableState.value.copy(
                operation = PrinterOperation.DISCOVERING,
                userMessage = null,
            )
            val candidates = when (mutableState.value.selectedTransport) {
                PrinterTransport.USB -> discoverUsb()
                PrinterTransport.LAN -> discoverLan()
                PrinterTransport.BLUETOOTH -> discoverBluetooth()
            }
            mutableState.value = mutableState.value.copy(
                candidates = candidates,
                operation = PrinterOperation.IDLE,
            )
        }
    }

    fun selectCandidate(identity: String) {
        val selected = mutableState.value.candidates.firstOrNull { it.identity == identity } ?: return
        if (
            selected.config is LocalTransportConfig.Usb &&
            usbInspector.scan().firstOrNull { it.deviceName == selected.config.deviceName }
                ?.hasPermission == false
        ) {
            selected.config.deviceName?.let {
                mutableEffects.tryEmit(PrinterDevicesEffect.RequestUsbPermission(it))
            }
        }
        mutableState.value = mutableState.value.copy(
            selectedCandidateId = identity,
            printerNameDraft = selected.displayName.take(80),
        )
    }

    fun pairBluetooth(identity: String) {
        scope.launch(Dispatchers.IO) {
            val started = bluetoothDiscovery.requestSystemPairing(identity)
            withContext(Dispatchers.Main) {
                mutableState.value = mutableState.value.copy(
                    userMessage = if (started) {
                        applicationContext.getString(R.string.controller_bluetooth_pairing_started)
                    } else {
                        applicationContext.getString(
                            R.string.controller_bluetooth_pairing_unavailable,
                        )
                    },
                )
            }
        }
    }

    fun beginManualLanEntry() {
        mutableState.value = mutableState.value.copy(
            manualLanEntryVisible = true,
            userMessage = null,
        )
    }

    fun onBluetoothPermissionDenied() {
        mutableState.value = mutableState.value.copy(
            bluetoothDiscoveryState = BluetoothDiscoveryState.PERMISSION_DENIED,
            operation = PrinterOperation.FAILURE,
            userMessage = applicationContext.getString(R.string.bluetooth_permission_denied),
        )
    }

    fun onBluetoothEnableDeclined() {
        mutableState.value = mutableState.value.copy(
            bluetoothDiscoveryState = BluetoothDiscoveryState.DISABLED,
            operation = PrinterOperation.FAILURE,
            userMessage = applicationContext.getString(
                R.string.controller_bluetooth_enable_declined,
            ),
        )
    }

    fun setManualLanAddress(host: String, port: Int = 9_100) {
        val config = runCatching { LocalTransportConfig.Lan(host.trim(), port) }.getOrNull()
        if (config == null) {
            mutableState.value = mutableState.value.copy(
                userMessage = applicationContext.getString(
                    R.string.controller_lan_address_invalid,
                ),
            )
            return
        }
        val candidate = PrinterCandidateCore(
            identity = "${config.host}:${config.port}",
            displayName = config.host,
            transport = PrinterTransport.LAN,
            endpoint = "${config.host}:${config.port}",
            config = config,
        )
        mutableState.value = mutableState.value.copy(
            candidates = listOf(candidate),
            selectedCandidateId = candidate.identity,
            printerNameDraft = candidate.displayName,
            manualLanEntryVisible = true,
            manualLanHost = config.host,
            manualLanPort = config.port,
            userMessage = null,
        )
    }

    fun setPrinterName(value: String) {
        mutableState.value = mutableState.value.copy(printerNameDraft = value.take(80))
    }

    fun setPaperWidth(widthMm: Int) {
        mutableState.value = mutableState.value.copy(
            paperWidth = if (widthMm == 58) PaperWidth.MM_58 else PaperWidth.MM_80,
        )
    }

    fun openBinding(localBindingId: String) {
        val binding = mutableState.value.bindings.firstOrNull {
            it.localBindingId == localBindingId
        } ?: return
        mutableState.value = mutableState.value.copy(
            selectedBindingId = localBindingId,
            route = PrinterDevicesCoreRoute.PRINTER_DETAIL,
            printerNameDraft = binding.displayName,
            nameEditVisible = false,
        )
    }

    fun beginEditName() {
        val selected = mutableState.value.selectedBindingId?.let { id ->
            mutableState.value.bindings.firstOrNull { it.localBindingId == id }
        } ?: return
        mutableState.value = mutableState.value.copy(
            nameEditVisible = true,
            printerNameDraft = selected.displayName,
            userMessage = null,
        )
    }

    fun dismissEditName() {
        mutableState.value = mutableState.value.copy(nameEditVisible = false)
    }

    fun confirmEditName() {
        val selectedId = mutableState.value.selectedBindingId ?: return
        val merchantId = credentialStore.readCredential()?.merchantId ?: return
        val name = mutableState.value.printerNameDraft.trim()
        if (name.isEmpty()) return
        scope.launch {
            mutableState.value = mutableState.value.copy(operation = PrinterOperation.SYNCING)
            runCatching { repository.updateDisplayName(merchantId, selectedId, name) }
                .onSuccess {
                    mutableState.value = mutableState.value.copy(
                        nameEditVisible = false,
                        operation = PrinterOperation.SUCCESS,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_saved_pending_sync,
                        ),
                    )
                }
                .onFailure {
                    mutableState.value = mutableState.value.copy(
                        operation = PrinterOperation.FAILURE,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_save_failed,
                        ),
                    )
                }
        }
    }

    fun test(bindingId: String? = null) {
        scope.launch {
            val binding = bindingId
                ?.let { id -> mutableState.value.bindings.firstOrNull { it.localBindingId == id } }
                ?: draftBinding()
            if (binding == null) {
                mutableState.value = mutableState.value.copy(
                    userMessage = applicationContext.getString(R.string.controller_select_printer),
                )
                return@launch
            }
            mutableState.value = mutableState.value.copy(operation = PrinterOperation.TESTING)
            val result = transportExecutor.printOnce(
                binding,
                PrintableDocument(
                    LocalTestDocumentFactory.render(binding),
                    "local-printer-test",
                ),
            )
            val physicalStatus = if (result is PrintResult.Success) {
                PhysicalStatus.CONNECTED
            } else {
                PhysicalStatus.ERROR
            }
            if (bindingId != null) {
                repository.recordPhysicalStatus(
                    binding,
                    physicalStatus,
                    StatusSource.LOCAL_TEST,
                    lastErrorCode = (result as? PrintResult.Failure)?.code?.name,
                    lastErrorMessage = (result as? PrintResult.Failure)?.technicalDetail,
                )
            } else {
                draftPhysicalStatus = physicalStatus
                draftLastTestedAt = clock()
                if (physicalStatus == PhysicalStatus.CONNECTED) {
                    draftLastConnectedAt = draftLastTestedAt
                }
            }
            mutableState.value = mutableState.value.copy(
                operation = when (result) {
                    is PrintResult.Success -> PrinterOperation.SUCCESS
                    is PrintResult.Failure -> if (result.ioAttempted || result.writtenBytes > 0) {
                        PrinterOperation.UNCERTAIN
                    } else {
                        PrinterOperation.FAILURE
                    }
                },
                userMessage = when (result) {
                    is PrintResult.Success -> applicationContext.getString(
                        R.string.controller_test_write_complete,
                    )
                    is PrintResult.Failure -> result.code.name
                },
            )
        }
    }

    fun saveDraft() {
        scope.launch {
            val binding = draftBinding() ?: return@launch
            mutableState.value = mutableState.value.copy(operation = PrinterOperation.SYNCING)
            runCatching { repository.addLocalBinding(binding) }
                .onSuccess {
                    mutableState.value = mutableState.value.copy(
                        selectedBindingId = binding.localBindingId,
                        route = if (binding.transport == PrinterTransport.LAN) {
                            PrinterDevicesCoreRoute.LAN_SUCCESS
                        } else {
                            PrinterDevicesCoreRoute.OVERVIEW
                        },
                        operation = PrinterOperation.SUCCESS,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_saved_pending_sync,
                        ),
                    )
                }
                .onFailure {
                    mutableState.value = mutableState.value.copy(
                        operation = PrinterOperation.FAILURE,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_save_failed,
                        ),
                    )
                }
        }
    }

    fun continueCurrentFlow() {
        when (mutableState.value.route) {
            PrinterDevicesCoreRoute.CONNECTION_TYPE -> continueAdd()
            PrinterDevicesCoreRoute.LAN_DISCOVERY -> testAndSaveLanDraft()
            else -> Unit
        }
    }

    fun finishAdd() {
        mutableState.value = mutableState.value.copy(
            route = PrinterDevicesCoreRoute.OVERVIEW,
            operation = PrinterOperation.IDLE,
            candidates = emptyList(),
            selectedCandidateId = null,
            manualLanEntryVisible = false,
            userMessage = null,
        )
    }

    fun requestArchive() {
        mutableState.value = mutableState.value.copy(archiveConfirmationVisible = true)
    }

    fun dismissArchive() {
        mutableState.value = mutableState.value.copy(archiveConfirmationVisible = false)
    }

    fun confirmArchive() {
        val id = mutableState.value.selectedBindingId ?: return
        val merchantId = credentialStore.readCredential()?.merchantId ?: return
        scope.launch {
            repository.requestArchive(merchantId, id)
            mutableState.value = mutableState.value.copy(
                archiveConfirmationVisible = false,
                route = PrinterDevicesCoreRoute.OVERVIEW,
                operation = PrinterOperation.ARCHIVED,
                userMessage = applicationContext.getString(
                    R.string.controller_printer_archive_pending_sync,
                ),
            )
        }
    }

    fun clear() {
        bindingObservation?.cancel()
        scope.cancel()
    }

    private fun testAndSaveLanDraft() {
        if (
            mutableState.value.operation in setOf(
                PrinterOperation.CONNECTING,
                PrinterOperation.TESTING,
                PrinterOperation.SYNCING,
            )
        ) return
        scope.launch {
            val binding = draftBinding()
            if (binding == null) {
                mutableState.value = mutableState.value.copy(
                    userMessage = applicationContext.getString(R.string.controller_select_printer),
                )
                return@launch
            }
            mutableState.value = mutableState.value.copy(
                operation = PrinterOperation.TESTING,
                userMessage = null,
            )
            val result = transportExecutor.printOnce(
                binding,
                PrintableDocument(
                    LocalTestDocumentFactory.render(binding),
                    "local-printer-test",
                ),
            )
            if (result is PrintResult.Failure) {
                mutableState.value = mutableState.value.copy(
                    operation = if (result.ioAttempted || result.writtenBytes > 0) {
                        PrinterOperation.UNCERTAIN
                    } else {
                        PrinterOperation.FAILURE
                    },
                    userMessage = result.code.name,
                )
                return@launch
            }
            draftPhysicalStatus = PhysicalStatus.CONNECTED
            val testedAt = clock()
            draftLastConnectedAt = testedAt
            draftLastTestedAt = testedAt
            val connectedBinding = binding.copy(
                localStatus = PhysicalStatus.CONNECTED,
                lastConnectedAt = testedAt,
                lastTestedAt = testedAt,
            )
            mutableState.value = mutableState.value.copy(operation = PrinterOperation.SYNCING)
            runCatching { repository.addLocalBinding(connectedBinding) }
                .onSuccess {
                    mutableState.value = mutableState.value.copy(
                        selectedBindingId = connectedBinding.localBindingId,
                        route = PrinterDevicesCoreRoute.LAN_SUCCESS,
                        operation = PrinterOperation.SUCCESS,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_saved_pending_sync,
                        ),
                    )
                }
                .onFailure {
                    mutableState.value = mutableState.value.copy(
                        operation = PrinterOperation.FAILURE,
                        userMessage = applicationContext.getString(
                            R.string.controller_printer_save_failed,
                        ),
                    )
                }
        }
    }

    private fun observeMerchant(merchantId: String?) {
        bindingObservation?.cancel()
        if (merchantId == null) {
            mutableState.value = mutableState.value.copy(bindings = emptyList())
            return
        }
        bindingObservation = scope.launch {
            repository.observeActiveBindings(merchantId).collect { values ->
                mutableState.value = mutableState.value.copy(bindings = values)
            }
        }
    }

    private suspend fun discoverUsb(): List<PrinterCandidateCore> = withContext(Dispatchers.IO) {
        usbInspector.scan().flatMap { device ->
            device.bulkOutOptions.take(1).map { option ->
                PrinterCandidateCore(
                    identity = device.deviceName,
                    displayName = device.displayName,
                    transport = PrinterTransport.USB,
                    endpoint = "VID ${device.vendorId} / PID ${device.productId}",
                    available = device.hasPermission,
                    config = LocalTransportConfig.Usb(
                        vendorId = device.vendorId,
                        productId = device.productId,
                        deviceName = device.deviceName,
                        interfaceIndex = option.interfaceIndex,
                        interfaceId = option.interfaceId,
                        alternateSetting = option.alternateSetting,
                        interfaceClass = device.interfaces
                            .getOrNull(option.interfaceIndex)
                            ?.interfaceClass,
                        endpointAddress = option.endpointAddress,
                    ),
                )
            }
        }
    }

    private suspend fun discoverLan(): List<PrinterCandidateCore> =
        lanDiscovery.discover().mapNotNull { candidate ->
            val host = candidate.identifier.substringBefore(':')
            val port = candidate.identifier.substringAfter(':').toIntOrNull() ?: return@mapNotNull null
            PrinterCandidateCore(
                identity = candidate.identifier,
                displayName = candidate.displayName,
                transport = PrinterTransport.LAN,
                endpoint = candidate.identifier,
                config = LocalTransportConfig.Lan(host, port),
            )
        }

    private suspend fun discoverBluetooth(): List<PrinterCandidateCore> =
        withContext(Dispatchers.IO) {
            val result = withTimeoutOrNull(BLUETOOTH_DISCOVERY_TIMEOUT_MS) {
                bluetoothDiscovery.nearbyDevices().last()
            } ?: bluetoothDiscovery.pairedDevices()
            mutableState.value = mutableState.value.copy(
                bluetoothDiscoveryState = result.state,
                userMessage = when (result.state) {
                    BluetoothDiscoveryState.UNAVAILABLE -> applicationContext.getString(
                        R.string.controller_bluetooth_unavailable,
                    )
                    BluetoothDiscoveryState.EMPTY -> applicationContext.getString(
                        R.string.bluetooth_empty,
                    )
                    else -> mutableState.value.userMessage
                },
            )
            when (result.state) {
                BluetoothDiscoveryState.PERMISSION_DENIED ->
                    mutableEffects.tryEmit(PrinterDevicesEffect.RequestBluetoothPermissions)
                BluetoothDiscoveryState.DISABLED ->
                    mutableEffects.tryEmit(PrinterDevicesEffect.RequestBluetoothEnable)
                else -> Unit
            }
            result.devices.map { candidate ->
                PrinterCandidateCore(
                    identity = candidate.identifier,
                    displayName = candidate.displayName,
                    transport = PrinterTransport.BLUETOOTH,
                    endpoint = candidate.identifier,
                    paired = candidate.bonded,
                    config = LocalTransportConfig.Bluetooth(
                        macAddress = candidate.identifier,
                        deviceName = candidate.displayName,
                        serviceUuid = PrinterConnectionConfig.DEFAULT_SPP_UUID,
                    ),
                )
            }
        }

    private suspend fun draftBinding(): LocalPrinterBinding? {
        val credential = credentialStore.readCredential() ?: return null
        val candidate = mutableState.value.candidates.firstOrNull {
            it.identity == mutableState.value.selectedCandidateId
        } ?: return null
        val name = mutableState.value.printerNameDraft.trim()
        if (name.isEmpty()) return null
        return LocalPrinterBinding(
            merchantId = credential.merchantId,
            terminalInstanceId = identityStore.terminalInstanceId(),
            localBindingId = draftBindingId,
            printerId = null,
            bindingVersion = 0,
            transport = candidate.transport,
            displayName = name,
            paperWidth = mutableState.value.paperWidth,
            transportConfig = candidate.config,
            localStatus = draftPhysicalStatus,
            syncStatus = BindingSyncStatus.LOCAL_ONLY,
            deletedPending = false,
            enabled = false,
            lastConnectedAt = draftLastConnectedAt,
            lastTestedAt = draftLastTestedAt,
            lastStatusReportAt = null,
        )
    }

    private companion object {
        const val BLUETOOTH_DISCOVERY_TIMEOUT_MS = 14_000L
    }
}

object LocalTestDocumentFactory {
    fun render(binding: LocalPrinterBinding): ByteArray {
        val width = binding.paperWidth.defaultDots
        val bitmap = Bitmap.createBitmap(width, 440, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = if (width <= 384) 23f else 30f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val bold = Paint(paint).apply {
            textSize = if (width <= 384) 28f else 36f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val margin = width * 0.06f
        var y = 54f
        listOf(
            "云桥打印测试" to bold,
            "YunQiao Printer Test" to paint,
            "Kiểm tra máy in" to paint,
            "Transport: ${binding.transport.name}" to paint,
            "Paper: ${if (binding.paperWidth == PaperWidth.MM_58) "58mm" else "80mm"}" to paint,
            "Time: ${Instant.now()}" to paint,
            "1234567890" to paint,
        ).forEach { (line, linePaint) ->
            canvas.drawText(line, margin, y, linePaint)
            y += linePaint.fontSpacing + 9f
        }
        return try {
            EscPosRasterEncoder.encodeBitmap(bitmap, 160, CutMode.HALF)
        } finally {
            bitmap.recycle()
        }
    }
}
