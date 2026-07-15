package com.yunqiao.life.merchantterminal.diagnostics

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.WindowManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.SeekBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.lifecycle.lifecycleScope
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.databinding.ActivityUsbPrinterDiagnosticsBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import com.yunqiao.life.merchantterminal.printing.PrintActionGate
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterConnectionConfig
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.UsbPrinterException
import com.yunqiao.life.merchantterminal.printing.escpos.AsciiSmokeReceiptEncoder
import com.yunqiao.life.merchantterminal.printing.escpos.EscPosRasterEncoder
import com.yunqiao.life.merchantterminal.printing.escpos.PrintWidthValidator
import com.yunqiao.life.merchantterminal.printing.render.ReceiptRenderConfig
import com.yunqiao.life.merchantterminal.printing.render.SmokeReceiptData
import com.yunqiao.life.merchantterminal.printing.render.SmokeReceiptRenderer
import com.yunqiao.life.merchantterminal.printing.usb.UsbAttachmentState
import com.yunqiao.life.merchantterminal.printing.usb.UsbConnectionOption
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceInspector
import com.yunqiao.life.merchantterminal.printing.usb.UsbEscPosAdapter
import com.yunqiao.life.merchantterminal.printing.usb.UsbPermissionController
import com.yunqiao.life.merchantterminal.printing.userMessageResource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Foreground-only smoke-test screen. It never consumes orders or schedules background work. */
class UsbPrinterDiagnosticsActivity : AppCompatActivity() {
    private lateinit var binding: ActivityUsbPrinterDiagnosticsBinding
    private lateinit var inspector: UsbDeviceInspector
    private lateinit var printerAdapter: UsbEscPosAdapter
    private lateinit var permissionController: UsbPermissionController

    private var devices: List<UsbDeviceDescriptor> = emptyList()
    private var endpointOptions: List<UsbConnectionOption> = emptyList()
    private var selectedDeviceName: String? = null
    private var attachmentState = UsbAttachmentState()
    private var lastTest: UsbTestRecord? = null
    private var activeAction: Job? = null
    private var isBusy = false
    private var suppressSpinnerCallbacks = false
    private val printActionGate = PrintActionGate()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding = ActivityUsbPrinterDiagnosticsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        inspector = UsbDeviceInspector(applicationContext)
        printerAdapter = UsbEscPosAdapter(applicationContext, inspector)
        permissionController = UsbPermissionController(
            activity = this,
            onPermissionResult = ::handlePermissionResult,
            onDeviceAttached = { refreshDevices(selectedDeviceName) },
            onDeviceDetached = ::handleDeviceDetached,
        )

        configureHeader()
        configureSpinners()
        configureThreshold()
        configureActions()
        refreshDevices(savedInstanceState?.getString(KEY_SELECTED_DEVICE))
        consumePermissionResultIntent(intent)
        enterImmersiveMode()
    }

    override fun onStart() {
        super.onStart()
        permissionController.register()
    }

    override fun onResume() {
        super.onResume()
        refreshDevices(selectedDeviceName)
        enterImmersiveMode()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!consumePermissionResultIntent(intent)) setIntent(intent)
    }

    override fun onStop() {
        permissionController.unregister()
        if (!isChangingConfigurations) {
            activeAction?.cancel()
            activeAction = null
            printerAdapter.closeConnectionImmediately()
            printActionGate.release()
            setBusy(false)
        }
        super.onStop()
    }

    override fun onDestroy() {
        printerAdapter.closeConnectionImmediately()
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(KEY_SELECTED_DEVICE, selectedDeviceName)
        super.onSaveInstanceState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    private fun configureHeader() {
        binding.deviceSummaryText.text = getString(
            R.string.usb_host_summary,
            "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            Build.VERSION.RELEASE,
            getString(
                if (inspector.isUsbHostSupported) R.string.usb_supported
                else R.string.usb_not_supported,
            ),
        )
        binding.closeUsbDiagnosticsButton.setOnClickListener { finish() }
        binding.copyUsbDiagnosticsButton.setOnClickListener { copyDiagnostics() }
    }

    private fun configureSpinners() {
        binding.paperWidthSpinner.adapter = simpleSpinnerAdapter(
            listOf(
                getString(R.string.usb_paper_80),
                getString(R.string.usb_paper_58),
                getString(R.string.usb_paper_custom),
            ),
        )
        binding.paperWidthSpinner.setSelection(PAPER_80_POSITION)
        binding.paperWidthSpinner.onItemSelectedListener = itemSelectedListener { position ->
            binding.customPrintDotsInput.isVisible = position == PAPER_CUSTOM_POSITION
        }

        binding.cutModeSpinner.adapter = simpleSpinnerAdapter(
            listOf(
                getString(R.string.usb_cut_none),
                getString(R.string.usb_cut_half),
                getString(R.string.usb_cut_full),
            ),
        )
        binding.cutModeSpinner.setSelection(CUT_NONE_POSITION)

        binding.usbDeviceSpinner.onItemSelectedListener = itemSelectedListener { position ->
            if (!suppressSpinnerCallbacks) selectDevice(devices.getOrNull(position)?.deviceName)
        }
        binding.usbEndpointSpinner.onItemSelectedListener = itemSelectedListener {
            updateControlAvailability()
        }
    }

    private fun configureThreshold() {
        binding.imageThresholdSeekbar.progress = DEFAULT_IMAGE_THRESHOLD
        updateThresholdLabel(DEFAULT_IMAGE_THRESHOLD)
        binding.imageThresholdSeekbar.setOnSeekBarChangeListener(
            object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    updateThresholdLabel(progress)
                }

                override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
                override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
            },
        )
    }

    private fun configureActions() {
        binding.refreshUsbDevicesButton.setOnClickListener { refreshDevices(selectedDeviceName) }
        binding.requestUsbPermissionButton.setOnClickListener { requestSelectedDevicePermission() }
        binding.testUsbConnectionButton.setOnClickListener {
            runSingleAction(::testConnection)
        }
        binding.printAsciiTestButton.setOnClickListener {
            runSingleAction(::printAsciiSmokeReceipt)
        }
        binding.printImageTestButton.setOnClickListener {
            runSingleAction(::printImageSmokeReceipt)
        }
    }

    private fun refreshDevices(preferredDeviceName: String?) {
        devices = inspector.scan()
        val attachedDeviceNames = devices.mapTo(mutableSetOf()) { it.deviceName }
        permissionController.reconcileAttachedDevices(attachedDeviceNames)
        attachmentState = attachmentState.onScan(attachedDeviceNames)
        val labels = if (devices.isEmpty()) {
            listOf(getString(R.string.usb_no_devices))
        } else {
            devices.map { device ->
                val prefix = getString(
                    if (device.likelyPrinter) R.string.usb_possible_printer_prefix
                    else R.string.usb_other_device_prefix,
                )
                "$prefix · ${device.displayName} · " +
                    "VID 0x${device.vendorId.toHex4()} / PID 0x${device.productId.toHex4()}"
            }
        }
        suppressSpinnerCallbacks = true
        binding.usbDeviceSpinner.adapter = simpleSpinnerAdapter(labels)
        val selectedIndex = devices.indexOfFirst { it.deviceName == preferredDeviceName }
            .takeIf { it >= 0 }
            ?: devices.indexOfFirst { it.likelyPrinter }.takeIf { it >= 0 }
            ?: 0
        binding.usbDeviceSpinner.setSelection(selectedIndex, false)
        suppressSpinnerCallbacks = false
        selectDevice(devices.getOrNull(selectedIndex)?.deviceName)
    }

    private fun selectDevice(deviceName: String?) {
        selectedDeviceName = deviceName
        attachmentState = attachmentState.onSelected(deviceName)
        val device = selectedDevice()
        endpointOptions = device?.bulkOutOptions.orEmpty()
        binding.usbEndpointSpinner.adapter = simpleSpinnerAdapter(
            if (endpointOptions.isEmpty()) {
                listOf(getString(R.string.usb_no_bulk_endpoint))
            } else {
                endpointOptions.map { option ->
                    "Interface index ${option.interfaceIndex} · id ${option.interfaceId} · " +
                        "alt ${option.alternateSetting} · Endpoint ${option.endpointNumber} " +
                        "(0x${option.endpointAddress.toHex2()}) · BULK OUT · " +
                        "maxPacket ${option.maxPacketSize}"
                }
            },
        )
        binding.usbEndpointSpinner.setSelection(0, false)
        binding.usbDeviceDetailsText.text = device?.let(::formatDeviceDetails)
            ?: getString(R.string.usb_no_devices)
        updateControlAvailability()
    }

    private fun requestSelectedDevicePermission() {
        val deviceDescriptor = selectedDevice() ?: run {
            showFailure(UsbPrintErrorCode.USB_DEVICE_NOT_FOUND)
            return
        }
        if (deviceDescriptor.hasPermission) return
        val device = inspector.findDevice(deviceDescriptor.deviceName)
        if (device == null) {
            showFailure(UsbPrintErrorCode.USB_DEVICE_NOT_FOUND)
            return
        }
        if (!permissionController.requestPermission(device)) {
            binding.usbActionResultText.text = getString(R.string.usb_permission_request_failed)
        }
        updateControlAvailability()
    }

    private fun handlePermissionResult(deviceName: String, granted: Boolean) {
        refreshDevices(deviceName)
        if (granted) {
            binding.usbActionResultText.text = getString(R.string.usb_permission_granted)
        } else {
            showFailure(UsbPrintErrorCode.USB_PERMISSION_DENIED)
        }
    }

    private fun consumePermissionResultIntent(intent: Intent?): Boolean {
        val consumed = permissionController.handlePermissionResult(intent)
        if (consumed) {
            // Do not replay a stale permission result if Android later recreates this Activity.
            setIntent(Intent(this, UsbPrinterDiagnosticsActivity::class.java))
        }
        return consumed
    }

    private fun handleDeviceDetached(deviceName: String?) {
        printerAdapter.notifyDeviceDetached(deviceName)
        attachmentState = attachmentState.onDetached(deviceName)
        if (deviceName != null && deviceName == selectedDeviceName) {
            showFailure(UsbPrintErrorCode.USB_DEVICE_DETACHED)
        }
        refreshDevices(null)
    }

    private fun runSingleAction(action: suspend (TestSelection) -> Unit) {
        if (!printActionGate.tryAcquire(SystemClock.elapsedRealtime())) return
        val selection = currentSelection()
        if (selection == null) {
            printActionGate.release()
            return
        }

        setBusy(true)
        binding.usbActionResultText.text = getString(R.string.usb_action_in_progress)
        activeAction = lifecycleScope.launch {
            try {
                action(selection)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (exception: UsbPrinterException) {
                showFailure(exception.code, exception.message)
            } catch (throwable: Throwable) {
                showFailure(
                    UsbPrintErrorCode.UNKNOWN_USB_ERROR,
                    throwable::class.java.simpleName,
                )
            } finally {
                withContext(NonCancellable) { printerAdapter.disconnect() }
                printActionGate.release()
                activeAction = null
                setBusy(false)
            }
        }
    }

    private suspend fun testConnection(selection: TestSelection) {
        val result = printerAdapter.connect(selection.connectionConfig)
        if (result.isFailure) {
            showConnectionFailure(result.exceptionOrNull())
            return
        }
        val message = getString(R.string.usb_interface_opened)
        lastTest = UsbTestRecord(
            timestampEpochMs = System.currentTimeMillis(),
            result = message,
        )
        binding.usbActionResultText.text = message
    }

    private suspend fun printAsciiSmokeReceipt(selection: TestSelection) {
        val bytes = AsciiSmokeReceiptEncoder.encode(
            deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            androidVersion = Build.VERSION.RELEASE,
            printerVendorId = selection.device.vendorId,
            printerProductId = selection.device.productId,
            timestamp = currentTimestamp(),
            cutMode = selectedCutMode(),
        )
        connectAndPrint(PrintableDocument(bytes, "usb-ascii-smoke"), selection)
    }

    private suspend fun printImageSmokeReceipt(selection: TestSelection) {
        val paperWidth = selectedPaperWidth()
        val dots = customDots()
        val threshold = binding.imageThresholdSeekbar.progress
        val cutMode = selectedCutMode()
        val timestamp = currentTimestamp()
        val bytes = withContext(Dispatchers.Default) {
            val bitmap = SmokeReceiptRenderer.render(
                data = SmokeReceiptData(
                    deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                    androidVersion = Build.VERSION.RELEASE,
                    printerVendorId = selection.device.vendorId,
                    printerProductId = selection.device.productId,
                    timestamp = timestamp,
                ),
                config = ReceiptRenderConfig(
                    paperWidth = paperWidth,
                    customDots = dots,
                ),
            )
            try {
                val raster = EscPosRasterEncoder.bitmapToRaster(
                    bitmap,
                    threshold,
                )
                EscPosRasterEncoder.encode(raster, cutMode)
            } finally {
                bitmap.recycle()
            }
        }
        connectAndPrint(PrintableDocument(bytes, "usb-multilingual-image-smoke"), selection)
    }

    private suspend fun connectAndPrint(document: PrintableDocument, selection: TestSelection) {
        val connectionResult = printerAdapter.connect(selection.connectionConfig)
        if (connectionResult.isFailure) {
            showConnectionFailure(connectionResult.exceptionOrNull())
            return
        }
        when (val result = printerAdapter.print(document)) {
            is PrintResult.Success -> {
                val message = getString(
                    R.string.usb_print_success,
                    result.plannedBytes,
                    result.writtenBytes,
                )
                lastTest = UsbTestRecord(
                    timestampEpochMs = System.currentTimeMillis(),
                    result = message,
                    plannedBytes = result.plannedBytes,
                    writtenBytes = result.writtenBytes,
                )
                binding.usbActionResultText.text = message
            }
            is PrintResult.Failure -> showFailure(
                code = result.code,
                technicalDetail = result.technicalDetail,
                plannedBytes = result.plannedBytes,
                writtenBytes = result.writtenBytes,
            )
        }
    }

    private fun showConnectionFailure(throwable: Throwable?) {
        val usbError = throwable as? UsbPrinterException
        showFailure(
            code = usbError?.code ?: UsbPrintErrorCode.UNKNOWN_USB_ERROR,
            technicalDetail = throwable?.message ?: throwable?.javaClass?.simpleName,
        )
    }

    private fun showFailure(
        code: UsbPrintErrorCode,
        technicalDetail: String? = null,
        plannedBytes: Int = 0,
        writtenBytes: Int = 0,
    ) {
        val message = getString(code.userMessageResource())
        val safeDetail = technicalDetail
            ?.replace(Regex("[\\r\\n\\t]+"), " ")
            ?.take(MAX_TECHNICAL_DETAIL_LENGTH)
        binding.usbActionResultText.text = buildString {
            appendLine(message)
            append("Code: ${code.name}")
            safeDetail?.takeIf(String::isNotBlank)?.let { append("\nDetail: $it") }
            if (plannedBytes > 0) append("\nBytes: $plannedBytes / $writtenBytes")
        }
        lastTest = UsbTestRecord(
            timestampEpochMs = System.currentTimeMillis(),
            result = message,
            errorCode = code.name,
            plannedBytes = plannedBytes,
            writtenBytes = writtenBytes,
        )
    }

    private fun currentSelection(): TestSelection? {
        if (!inspector.isUsbHostSupported) {
            showFailure(UsbPrintErrorCode.USB_HOST_NOT_SUPPORTED)
            return null
        }
        val device = selectedDevice()
        if (device == null) {
            showFailure(UsbPrintErrorCode.USB_DEVICE_NOT_FOUND)
            return null
        }
        if (!device.hasPermission) {
            showFailure(UsbPrintErrorCode.USB_PERMISSION_REQUIRED)
            return null
        }
        val option = endpointOptions.getOrNull(binding.usbEndpointSpinner.selectedItemPosition)
        if (option == null) {
            showFailure(UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND)
            return null
        }
        return TestSelection(
            device = device,
            connectionConfig = PrinterConnectionConfig.Usb(
                deviceName = device.deviceName,
                interfaceIndex = option.interfaceIndex,
                interfaceId = option.interfaceId,
                alternateSetting = option.alternateSetting,
                endpointAddress = option.endpointAddress,
            ),
        )
    }

    private fun updateControlAvailability() {
        val device = selectedDevice()
        val ready = inspector.isUsbHostSupported &&
            device?.hasPermission == true &&
            endpointOptions.isNotEmpty() &&
            !isBusy
        binding.requestUsbPermissionButton.isEnabled =
            !isBusy && device != null && !device.hasPermission && !permissionController.hasPendingRequest()
        binding.requestUsbPermissionButton.text = getString(
            if (device?.hasPermission == true) R.string.usb_permission_granted
            else R.string.usb_request_permission,
        )
        binding.testUsbConnectionButton.isEnabled = ready
        binding.printAsciiTestButton.isEnabled = ready
        binding.printImageTestButton.isEnabled = ready
        binding.refreshUsbDevicesButton.isEnabled = !isBusy
        binding.usbDeviceSpinner.isEnabled = !isBusy && devices.isNotEmpty()
        binding.usbEndpointSpinner.isEnabled = !isBusy && endpointOptions.isNotEmpty()
        binding.paperWidthSpinner.isEnabled = !isBusy
        binding.customPrintDotsInput.isEnabled = !isBusy
        binding.cutModeSpinner.isEnabled = !isBusy
        binding.imageThresholdSeekbar.isEnabled = !isBusy
    }

    private fun setBusy(value: Boolean) {
        isBusy = value
        binding.usbActionProgress.isVisible = value
        updateControlAvailability()
    }

    private fun copyDiagnostics() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val report = UsbDiagnosticReport.build(
            activity = this,
            usbHostSupported = inspector.isUsbHostSupported,
            devices = devices,
            selectedDeviceName = selectedDeviceName,
            selectedInterfaceIndex = selectedEndpointOption()?.interfaceIndex,
            selectedInterfaceId = selectedEndpointOption()?.interfaceId,
            selectedAlternateSetting = selectedEndpointOption()?.alternateSetting,
            selectedEndpointAddress = selectedEndpointOption()?.endpointAddress,
            config = UsbDiagnosticConfig(
                paperWidth = selectedPaperWidth(),
                printDots = runCatching {
                    PrintWidthValidator.resolve(selectedPaperWidth(), customDots())
                }.getOrNull(),
                threshold = binding.imageThresholdSeekbar.progress,
                cutMode = selectedCutMode(),
            ),
            lastTest = lastTest,
        )
        clipboard.setPrimaryClip(ClipData.newPlainText("YunQiao USB diagnostics", report))
        Toast.makeText(this, R.string.usb_diagnostics_copied, Toast.LENGTH_SHORT).show()
    }

    private fun selectedDevice(): UsbDeviceDescriptor? =
        devices.firstOrNull { it.deviceName == selectedDeviceName }

    private fun selectedEndpointOption(): UsbConnectionOption? =
        endpointOptions.getOrNull(binding.usbEndpointSpinner.selectedItemPosition)

    private fun selectedPaperWidth(): PaperWidth = when (binding.paperWidthSpinner.selectedItemPosition) {
        PAPER_58_POSITION -> PaperWidth.MM_58
        PAPER_CUSTOM_POSITION -> PaperWidth.CUSTOM
        else -> PaperWidth.MM_80
    }

    private fun customDots(): Int? = binding.customPrintDotsInput.text
        ?.toString()
        ?.trim()
        ?.toIntOrNull()

    private fun selectedCutMode(): CutMode = when (binding.cutModeSpinner.selectedItemPosition) {
        CUT_HALF_POSITION -> CutMode.HALF
        CUT_FULL_POSITION -> CutMode.FULL
        else -> CutMode.NONE
    }

    private fun formatDeviceDetails(device: UsbDeviceDescriptor): String = buildString {
        appendLine("deviceName: ${device.deviceName}")
        appendLine("manufacturer: ${device.manufacturerName ?: "unknown"}")
        appendLine("product: ${device.productName ?: "unknown"}")
        appendLine("VID: ${device.vendorId} / 0x${device.vendorId.toHex4()}")
        appendLine("PID: ${device.productId} / 0x${device.productId.toHex4()}")
        appendLine(
            "device class/subclass/protocol: ${device.deviceClass}/" +
                "${device.deviceSubclass}/${device.deviceProtocol}",
        )
        appendLine("interfaceCount: ${device.interfaces.size}")
        appendLine("permission: ${device.hasPermission}")
        appendLine("possible printer: ${device.likelyPrinter}")
        device.interfaces.forEach { usbInterface ->
            appendLine(
                "interface index ${usbInterface.index}, id ${usbInterface.id}, " +
                    "alt ${usbInterface.alternateSetting}: class/subclass/protocol " +
                    "${usbInterface.interfaceClass}/${usbInterface.interfaceSubclass}/" +
                    "${usbInterface.interfaceProtocol}, endpointCount ${usbInterface.endpoints.size}",
            )
            usbInterface.endpoints.forEach { endpoint ->
                appendLine(
                    "  endpoint ${endpoint.endpointNumber}: ${endpoint.direction} ${endpoint.type}, " +
                        "address 0x${endpoint.address.toHex2()}, maxPacketSize " +
                        "${endpoint.maxPacketSize}, interval ${endpoint.interval}",
                )
            }
        }
    }

    private fun simpleSpinnerAdapter(values: List<String>): ArrayAdapter<String> =
        ArrayAdapter(this, android.R.layout.simple_spinner_item, values).apply {
            setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }

    private fun itemSelectedListener(onSelected: (Int) -> Unit) =
        object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                onSelected(position)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

    private fun updateThresholdLabel(value: Int) {
        binding.thresholdLabel.text = getString(R.string.usb_threshold_format, value)
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun currentTimestamp(): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss XXX", Locale.US).format(Date())

    private fun Int.toHex2(): String = toString(16).uppercase().padStart(2, '0')
    private fun Int.toHex4(): String = toString(16).uppercase().padStart(4, '0')

    private data class TestSelection(
        val device: UsbDeviceDescriptor,
        val connectionConfig: PrinterConnectionConfig.Usb,
    )

    private companion object {
        const val KEY_SELECTED_DEVICE = "selected_usb_device_name"
        const val DEFAULT_IMAGE_THRESHOLD = 160
        const val MAX_TECHNICAL_DETAIL_LENGTH = 240
        const val PAPER_80_POSITION = 0
        const val PAPER_58_POSITION = 1
        const val PAPER_CUSTOM_POSITION = 2
        const val CUT_NONE_POSITION = 0
        const val CUT_HALF_POSITION = 1
        const val CUT_FULL_POSITION = 2
    }
}
