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
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothClassicDiscovery
import com.yunqiao.life.merchantterminal.printing.bluetooth.BluetoothDiscoveryState
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.lan.LanPrinterDiscovery
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.runtime.ConnectorRuntimeStatus
import com.yunqiao.life.merchantterminal.runtime.TerminalRuntime
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.TerminalCredential
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.storage.PrintingRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
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

enum class UsbPermissionState {
    IDLE,
    REQUIRED,
    REQUESTING,
    GRANTED,
    DENIED,
    FAILED,
    TIMED_OUT,
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

internal fun usbCandidatesFrom(
    devices: List<UsbDeviceDescriptor>,
): List<PrinterCandidateCore> = devices.flatMap { device ->
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

private data class CandidateDiscovery(
    val candidates: List<PrinterCandidateCore>,
    val userMessage: String? = null,
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
    val usbPermissionState: UsbPermissionState = UsbPermissionState.IDLE,
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
    private val usbScanner: () -> List<UsbDeviceDescriptor> = usbInspector::scan,
    private val lanScanner: suspend () -> List<PrinterCandidate> = lanDiscovery::discover,
    private val printOnce: suspend (LocalPrinterBinding, PrintableDocument) -> PrintResult =
        transportExecutor::printOnce,
    private val saveBinding: suspend (LocalPrinterBinding) -> Unit = repository::addLocalBinding,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val readCredential: () -> TerminalCredential? = credentialStore::readCredential,
    private val terminalInstanceId: suspend () -> String = identityStore::terminalInstanceId,
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
            usbPermissionState = UsbPermissionState.IDLE,
            userMessage = null,
        )
    }

    fun selectTransport(transport: PrinterTransport) {
        mutableState.value = mutableState.value.copy(
            selectedTransport = transport,
            candidates = emptyList(),
            selectedCandidateId = null,
            printerNameDraft = "",
            usbPermissionState = UsbPermissionState.IDLE,
            userMessage = null,
        )
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
            val transport = mutableState.value.selectedTransport
            mutableState.value = mutableState.value.copy(
                operation = PrinterOperation.DISCOVERING,
                userMessage = null,
            )
            try {
                val discovery = when (transport) {
                    PrinterTransport.USB -> discoverUsb()
                    PrinterTransport.LAN -> CandidateDiscovery(discoverLan())
                    PrinterTransport.BLUETOOTH -> CandidateDiscovery(
                        discoverBluetooth(),
                        mutableState.value.userMessage,
                    )
                }
                val previousSelection = mutableState.value.selectedCandidateId
                val selected = previousSelection?.let { identity ->
                    discovery.candidates.firstOrNull { it.identity == identity }
                }
                val staleMessage = if (previousSelection != null && selected == null) {
                    applicationContext.getString(
                        if (transport == PrinterTransport.USB) {
                            R.string.controller_usb_device_missing
                        } else {
                            R.string.controller_printer_list_updated
                        },
                    )
                } else {
                    null
                }
                mutableState.value = mutableState.value.copy(
                    candidates = discovery.candidates,
                    selectedCandidateId = selected?.identity,
                    printerNameDraft = if (previousSelection != null && selected == null) {
                        ""
                    } else {
                        mutableState.value.printerNameDraft
                    },
                    operation = PrinterOperation.IDLE,
                    usbPermissionState = permissionStateAfterRefresh(
                        transport,
                        selected,
                        mutableState.value.usbPermissionState,
                    ),
                    userMessage = discovery.userMessage ?: staleMessage,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.FAILURE,
                    userMessage = applicationContext.getString(
                        when (transport) {
                            PrinterTransport.USB -> R.string.controller_usb_scan_failed
                            PrinterTransport.LAN -> R.string.lan_search_failure
                            PrinterTransport.BLUETOOTH -> R.string.bluetooth_empty
                        },
                    ),
                )
            } finally {
                if (mutableState.value.operation == PrinterOperation.DISCOVERING) {
                    mutableState.value = mutableState.value.copy(operation = PrinterOperation.IDLE)
                }
            }
        }
    }

    fun selectCandidate(identity: String) {
        val selected = mutableState.value.candidates.firstOrNull { it.identity == identity }
        if (selected == null) {
            mutableState.value = mutableState.value.copy(
                selectedCandidateId = null,
                printerNameDraft = "",
                operation = PrinterOperation.IDLE,
                usbPermissionState = UsbPermissionState.IDLE,
                userMessage = applicationContext.getString(
                    if (mutableState.value.selectedTransport == PrinterTransport.USB) {
                        R.string.controller_usb_device_missing
                    } else {
                        R.string.controller_printer_list_updated
                    },
                ),
            )
            return
        }
        mutableState.value = mutableState.value.copy(
            selectedCandidateId = identity,
            printerNameDraft = selected.displayName.take(80),
            operation = PrinterOperation.IDLE,
            usbPermissionState = if (
                selected.transport == PrinterTransport.USB && selected.available
            ) {
                UsbPermissionState.GRANTED
            } else if (selected.transport == PrinterTransport.USB) {
                UsbPermissionState.REQUIRED
            } else {
                UsbPermissionState.IDLE
            },
            userMessage = null,
        )
        if (selected.transport == PrinterTransport.USB) requestUsbPermission(identity)
    }

    fun onUsbPermissionRequestStarted(deviceName: String) {
        if (!isSelectedUsbDevice(deviceName)) return
        mutableState.value = mutableState.value.copy(
            operation = PrinterOperation.CONNECTING,
            usbPermissionState = UsbPermissionState.REQUESTING,
            userMessage = applicationContext.getString(R.string.usb_permission_waiting),
        )
    }

    fun onUsbPermissionRequestAlreadyPending(deviceName: String) {
        onUsbPermissionRequestStarted(deviceName)
    }

    fun onUsbPermissionRequestFailed(deviceName: String?) {
        if (deviceName != null && !isSelectedUsbDevice(deviceName)) return
        mutableState.value = mutableState.value.copy(
            operation = PrinterOperation.FAILURE,
            usbPermissionState = UsbPermissionState.FAILED,
            userMessage = applicationContext.getString(R.string.controller_usb_permission_failed),
        )
    }

    fun onUsbPermissionResult(deviceName: String, granted: Boolean) {
        if (!isSelectedUsbDevice(deviceName)) return
        mutableState.value = mutableState.value.copy(
            candidates = mutableState.value.candidates.map { candidate ->
                if (candidate.identity == deviceName && candidate.transport == PrinterTransport.USB) {
                    candidate.copy(available = granted)
                } else {
                    candidate
                }
            },
            operation = if (granted) PrinterOperation.IDLE else PrinterOperation.FAILURE,
            usbPermissionState = if (granted) {
                UsbPermissionState.GRANTED
            } else {
                UsbPermissionState.DENIED
            },
            userMessage = if (granted) {
                null
            } else {
                applicationContext.getString(R.string.usb_permission_denied)
            },
        )
        if (granted) refresh()
    }

    fun onUsbPermissionTimeout(deviceName: String) {
        if (!isSelectedUsbDevice(deviceName)) return
        mutableState.value = mutableState.value.copy(
            operation = PrinterOperation.FAILURE,
            usbPermissionState = UsbPermissionState.TIMED_OUT,
            userMessage = applicationContext.getString(R.string.controller_usb_permission_timeout),
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
            operation = PrinterOperation.IDLE,
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
            operation = PrinterOperation.IDLE,
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
        val merchantId = readCredential()?.merchantId ?: return
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
        if (mutableState.value.operation.isBusy()) {
            mutableState.value = mutableState.value.copy(
                userMessage = applicationContext.getString(R.string.controller_operation_in_progress),
            )
            return
        }
        scope.launch {
            val persistedBinding = bindingId?.let { id ->
                mutableState.value.bindings.firstOrNull { it.localBindingId == id }
            }
            try {
                if (
                    persistedBinding == null &&
                    mutableState.value.selectedTransport == PrinterTransport.USB &&
                    !ensureSelectedUsbPermission()
                ) {
                    return@launch
                }
                val binding = persistedBinding ?: draftBinding()
                if (binding == null) {
                    showMissingDraft()
                    return@launch
                }
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.TESTING,
                    userMessage = null,
                )
                val result = printOnce(
                    binding,
                    PrintableDocument(
                        PrinterDiagnosticRasterBuilder.render(binding),
                        "local-printer-test",
                    ),
                )
                val physicalStatus = if (result is PrintResult.Success) {
                    PhysicalStatus.CONNECTED
                } else {
                    PhysicalStatus.ERROR
                }
                if (persistedBinding != null) {
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
                        is PrintResult.Failure -> if (
                            result.ioAttempted || result.writtenBytes > 0
                        ) {
                            PrinterOperation.UNCERTAIN
                        } else {
                            PrinterOperation.FAILURE
                        }
                    },
                    userMessage = when (result) {
                        is PrintResult.Success -> applicationContext.getString(
                            R.string.controller_test_write_complete,
                        )
                        is PrintResult.Failure -> printFailureMessage(binding.transport, result.code)
                    },
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.FAILURE,
                    userMessage = applicationContext.getString(
                        if (persistedBinding?.transport == PrinterTransport.LAN ||
                            mutableState.value.selectedTransport == PrinterTransport.LAN
                        ) {
                            R.string.controller_lan_test_failed
                        } else {
                            R.string.controller_printer_test_failed
                        },
                    ),
                )
            }
        }
    }

    fun saveDraft() {
        if (mutableState.value.operation.isBusy()) {
            mutableState.value = mutableState.value.copy(
                userMessage = applicationContext.getString(R.string.controller_operation_in_progress),
            )
            return
        }
        scope.launch {
            try {
                if (
                    mutableState.value.selectedTransport == PrinterTransport.USB &&
                    !ensureSelectedUsbPermission()
                ) {
                    return@launch
                }
                val binding = draftBinding()
                if (binding == null) {
                    showMissingDraft()
                    return@launch
                }
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.SYNCING,
                    userMessage = null,
                )
                saveBinding(binding)
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
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
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
            usbPermissionState = UsbPermissionState.IDLE,
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
        val merchantId = readCredential()?.merchantId ?: return
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

    private fun requestUsbPermission(identity: String) {
        scope.launch {
            if (mutableState.value.selectedCandidateId != identity) return@launch
            ensureSelectedUsbPermission()
        }
    }

    private suspend fun ensureSelectedUsbPermission(): Boolean {
        val selectedId = mutableState.value.selectedCandidateId
        val selected = selectedId?.let { identity ->
            mutableState.value.candidates.firstOrNull { it.identity == identity }
        }
        val config = selected?.config as? LocalTransportConfig.Usb
        if (selected == null || config == null) {
            showMissingDraft()
            return false
        }
        val deviceName = config.deviceName ?: selected.identity
        val descriptor = try {
            withContext(ioDispatcher) {
                usbScanner().firstOrNull { it.deviceName == deviceName }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            mutableState.value = mutableState.value.copy(
                operation = PrinterOperation.FAILURE,
                usbPermissionState = UsbPermissionState.FAILED,
                userMessage = applicationContext.getString(R.string.controller_usb_scan_failed),
            )
            return false
        }
        if (descriptor == null) {
            mutableState.value = mutableState.value.copy(
                candidates = mutableState.value.candidates.filterNot {
                    it.identity == selected.identity
                },
                selectedCandidateId = null,
                printerNameDraft = "",
                operation = PrinterOperation.FAILURE,
                usbPermissionState = UsbPermissionState.IDLE,
                userMessage = applicationContext.getString(
                    R.string.controller_usb_device_missing,
                ),
            )
            return false
        }
        if (descriptor.bulkOutOptions.isEmpty()) {
            mutableState.value = mutableState.value.copy(
                candidates = mutableState.value.candidates.filterNot {
                    it.identity == selected.identity
                },
                selectedCandidateId = null,
                printerNameDraft = "",
                operation = PrinterOperation.FAILURE,
                usbPermissionState = UsbPermissionState.FAILED,
                userMessage = applicationContext.getString(
                    R.string.controller_usb_endpoint_unavailable,
                ),
            )
            return false
        }
        if (descriptor.hasPermission) {
            mutableState.value = mutableState.value.copy(
                candidates = mutableState.value.candidates.map { candidate ->
                    if (candidate.identity == selected.identity) {
                        candidate.copy(available = true)
                    } else {
                        candidate
                    }
                },
                operation = PrinterOperation.IDLE,
                usbPermissionState = UsbPermissionState.GRANTED,
                userMessage = null,
            )
            return true
        }
        mutableState.value = mutableState.value.copy(
            candidates = mutableState.value.candidates.map { candidate ->
                if (candidate.identity == selected.identity) {
                    candidate.copy(available = false)
                } else {
                    candidate
                }
            },
            operation = PrinterOperation.IDLE,
            usbPermissionState = UsbPermissionState.REQUIRED,
            userMessage = applicationContext.getString(
                R.string.controller_usb_permission_required,
            ),
        )
        mutableEffects.emit(PrinterDevicesEffect.RequestUsbPermission(deviceName))
        return false
    }

    private fun isSelectedUsbDevice(deviceName: String): Boolean {
        val selected = mutableState.value.selectedCandidateId?.let { identity ->
            mutableState.value.candidates.firstOrNull { it.identity == identity }
        } ?: return false
        val config = selected.config as? LocalTransportConfig.Usb ?: return false
        return (config.deviceName ?: selected.identity) == deviceName
    }

    private fun showMissingDraft() {
        val selectedId = mutableState.value.selectedCandidateId
        val selectedExists = selectedId != null && mutableState.value.candidates.any {
            it.identity == selectedId
        }
        val message = when {
            selectedId != null && !selectedExists -> applicationContext.getString(
                R.string.controller_printer_list_updated,
            )
            selectedExists -> applicationContext.getString(
                R.string.controller_printer_save_failed,
            )
            mutableState.value.selectedTransport == PrinterTransport.USB ->
                applicationContext.getString(R.string.controller_usb_select_printer)
            else -> applicationContext.getString(R.string.controller_select_printer)
        }
        mutableState.value = mutableState.value.copy(
            selectedCandidateId = selectedId.takeIf { selectedExists },
            operation = PrinterOperation.FAILURE,
            usbPermissionState = if (selectedExists) {
                mutableState.value.usbPermissionState
            } else {
                UsbPermissionState.IDLE
            },
            userMessage = message,
        )
    }

    private fun printFailureMessage(
        transport: PrinterTransport,
        code: UsbPrintErrorCode,
    ): String = when (transport) {
        PrinterTransport.USB -> applicationContext.getString(
            when (code) {
                UsbPrintErrorCode.USB_OPEN_FAILED,
                UsbPrintErrorCode.USB_CLAIM_INTERFACE_FAILED,
                UsbPrintErrorCode.USB_IO_BUSY
                -> R.string.controller_usb_device_busy
                UsbPrintErrorCode.USB_INTERFACE_NOT_FOUND,
                UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND,
                UsbPrintErrorCode.TRANSPORT_CONFIG_MISMATCH
                -> R.string.controller_usb_endpoint_unavailable
                UsbPrintErrorCode.USB_DEVICE_NOT_FOUND,
                UsbPrintErrorCode.USB_DEVICE_DETACHED
                -> R.string.controller_usb_device_missing
                UsbPrintErrorCode.USB_PERMISSION_REQUIRED ->
                    R.string.controller_usb_permission_required
                UsbPrintErrorCode.USB_PERMISSION_DENIED -> R.string.usb_permission_denied
                else -> R.string.controller_printer_test_failed
            },
        )
        PrinterTransport.LAN -> applicationContext.getString(R.string.controller_lan_test_failed)
        PrinterTransport.BLUETOOTH -> code.name
    }

    private fun permissionStateAfterRefresh(
        transport: PrinterTransport,
        selected: PrinterCandidateCore?,
        previous: UsbPermissionState,
    ): UsbPermissionState {
        if (transport != PrinterTransport.USB || selected == null) {
            return UsbPermissionState.IDLE
        }
        if (selected.available) return UsbPermissionState.GRANTED
        return when (previous) {
            UsbPermissionState.REQUESTING,
            UsbPermissionState.DENIED,
            UsbPermissionState.FAILED,
            UsbPermissionState.TIMED_OUT,
            -> previous
            else -> UsbPermissionState.REQUIRED
        }
    }

    private fun testAndSaveLanDraft() {
        if (mutableState.value.operation.isBusy()) {
            mutableState.value = mutableState.value.copy(
                userMessage = applicationContext.getString(R.string.controller_operation_in_progress),
            )
            return
        }
        scope.launch {
            var saving = false
            try {
                val binding = draftBinding()
                if (binding == null) {
                    showMissingDraft()
                    return@launch
                }
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.TESTING,
                    userMessage = null,
                )
                val result = printOnce(
                    binding,
                    PrintableDocument(
                        PrinterDiagnosticRasterBuilder.render(binding),
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
                        userMessage = applicationContext.getString(
                            R.string.controller_lan_test_failed,
                        ),
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
                saving = true
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.SYNCING,
                    userMessage = null,
                )
                saveBinding(connectedBinding)
                mutableState.value = mutableState.value.copy(
                    selectedBindingId = connectedBinding.localBindingId,
                    route = PrinterDevicesCoreRoute.LAN_SUCCESS,
                    operation = PrinterOperation.SUCCESS,
                    userMessage = applicationContext.getString(
                        R.string.controller_printer_saved_pending_sync,
                    ),
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                mutableState.value = mutableState.value.copy(
                    operation = PrinterOperation.FAILURE,
                    userMessage = applicationContext.getString(
                        if (saving) {
                            R.string.controller_printer_save_failed
                        } else {
                            R.string.controller_lan_test_failed
                        },
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

    private suspend fun discoverUsb(): CandidateDiscovery = withContext(ioDispatcher) {
        val devices = usbScanner()
        val candidates = usbCandidatesFrom(devices)
        CandidateDiscovery(
            candidates = candidates,
            userMessage = if (devices.isNotEmpty() && candidates.isEmpty()) {
                applicationContext.getString(R.string.controller_usb_endpoint_unavailable)
            } else {
                null
            },
        )
    }

    private suspend fun discoverLan(): List<PrinterCandidateCore> =
        lanScanner().mapNotNull { candidate ->
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
        withContext(ioDispatcher) {
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
        val credential = readCredential() ?: return null
        val candidate = mutableState.value.candidates.firstOrNull {
            it.identity == mutableState.value.selectedCandidateId
        } ?: return null
        val name = mutableState.value.printerNameDraft.trim()
        if (name.isEmpty()) return null
        return LocalPrinterBinding(
            merchantId = credential.merchantId,
            terminalInstanceId = terminalInstanceId(),
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

private fun PrinterOperation.isBusy(): Boolean = this in setOf(
    PrinterOperation.DISCOVERING,
    PrinterOperation.CONNECTING,
    PrinterOperation.TESTING,
    PrinterOperation.SYNCING,
)

/** DIAGNOSTIC TEST PRINT ONLY. Production PrintJob execution cannot reference this builder. */
object PrinterDiagnosticRasterBuilder {
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
