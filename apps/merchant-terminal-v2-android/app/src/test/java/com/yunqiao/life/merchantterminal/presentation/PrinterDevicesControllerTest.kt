package com.yunqiao.life.merchantterminal.presentation

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.model.LocalPrinterBinding
import com.yunqiao.life.merchantterminal.model.PrinterTransport
import com.yunqiao.life.merchantterminal.printing.PrintResult
import com.yunqiao.life.merchantterminal.printing.PrintableDocument
import com.yunqiao.life.merchantterminal.printing.PrinterCandidate
import com.yunqiao.life.merchantterminal.printing.PrinterChannel
import com.yunqiao.life.merchantterminal.printing.UsbPrintErrorCode
import com.yunqiao.life.merchantterminal.printing.usb.UsbDeviceDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointDescriptor
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointDirection
import com.yunqiao.life.merchantterminal.printing.usb.UsbEndpointType
import com.yunqiao.life.merchantterminal.printing.usb.UsbInterfaceDescriptor
import com.yunqiao.life.merchantterminal.security.TerminalCredential
import com.yunqiao.life.merchantterminal.security.TerminalIdentityStore
import com.yunqiao.life.merchantterminal.security.V2CredentialStore
import com.yunqiao.life.merchantterminal.storage.PrintingRepository
import com.yunqiao.life.merchantterminal.storage.V2PrintingDatabase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class PrinterDevicesControllerTest {
    private val scheduler = TestCoroutineScheduler()
    private val dispatcher = StandardTestDispatcher(scheduler)
    private val context: Context = ApplicationProvider.getApplicationContext()
    private lateinit var database: V2PrintingDatabase
    private lateinit var controller: PrinterDevicesController
    private var usbDevices = listOf<UsbDeviceDescriptor>()
    private var usbScanFailure: Throwable? = null
    private var lanDevices = listOf<PrinterCandidate>()
    private var printBehavior: suspend (LocalPrinterBinding, PrintableDocument) -> PrintResult =
        { _, _ -> success() }
    private var saveBehavior: suspend (LocalPrinterBinding) -> Unit = {}

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        database = Room.inMemoryDatabaseBuilder(context, V2PrintingDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        val repository = PrintingRepository(database)
        controller = PrinterDevicesController(
            context = context,
            repository = repository,
            credentialStore = V2CredentialStore(context),
            identityStore = TerminalIdentityStore(context),
            usbScanner = {
                usbScanFailure?.let { throw it }
                usbDevices
            },
            lanScanner = { lanDevices },
            printOnce = { binding, document -> printBehavior(binding, document) },
            saveBinding = { binding -> saveBehavior(binding) },
            ioDispatcher = dispatcher,
            readCredential = { credential() },
            terminalInstanceId = { TERMINAL_INSTANCE_ID },
        )
        scheduler.runCurrent()
    }

    @After
    fun tearDown() {
        controller.clear()
        database.close()
        Dispatchers.resetMain()
    }

    @Test
    fun `entering usb page refreshes and exposes no-permission candidate`() {
        usbDevices = listOf(usbDevice(hasPermission = false))

        openUsb()

        assertEquals(PrinterDevicesCoreRoute.USB_SETUP, controller.state.value.route)
        val candidate = controller.state.value.candidates.single()
        assertEquals(USB_DEVICE, candidate.identity)
        assertFalse(candidate.available)
        assertEquals(PrinterOperation.IDLE, controller.state.value.operation)
    }

    @Test
    fun `selecting usb candidate persists selection before reliable permission effect`() {
        usbDevices = listOf(usbDevice(hasPermission = false))
        openUsb()

        val effect = captureEffect { controller.selectCandidate(USB_DEVICE) }

        assertEquals(USB_DEVICE, controller.state.value.selectedCandidateId)
        assertEquals("Target USB", controller.state.value.printerNameDraft)
        assertEquals(UsbPermissionState.REQUIRED, controller.state.value.usbPermissionState)
        assertEquals(PrinterDevicesEffect.RequestUsbPermission(USB_DEVICE), effect)
    }

    @Test
    fun `permission callbacks distinguish started granted denied failed and timeout`() {
        usbDevices = listOf(usbDevice(hasPermission = false))
        openUsb()
        captureEffect { controller.selectCandidate(USB_DEVICE) }

        controller.onUsbPermissionRequestStarted(USB_DEVICE)
        assertEquals(UsbPermissionState.REQUESTING, controller.state.value.usbPermissionState)
        assertEquals(PrinterOperation.CONNECTING, controller.state.value.operation)

        controller.onUsbPermissionResult(USB_DEVICE, false)
        assertEquals(UsbPermissionState.DENIED, controller.state.value.usbPermissionState)
        assertEquals(context.getString(R.string.usb_permission_denied), controller.state.value.userMessage)

        controller.onUsbPermissionRequestFailed(USB_DEVICE)
        assertEquals(UsbPermissionState.FAILED, controller.state.value.usbPermissionState)
        assertEquals(
            context.getString(R.string.controller_usb_permission_failed),
            controller.state.value.userMessage,
        )

        controller.onUsbPermissionTimeout(USB_DEVICE)
        assertEquals(UsbPermissionState.TIMED_OUT, controller.state.value.usbPermissionState)

        usbDevices = listOf(usbDevice(hasPermission = true))
        controller.onUsbPermissionResult(USB_DEVICE, true)
        scheduler.advanceUntilIdle()
        assertEquals(UsbPermissionState.GRANTED, controller.state.value.usbPermissionState)
        assertEquals(USB_DEVICE, controller.state.value.selectedCandidateId)
        assertEquals(PrinterOperation.IDLE, controller.state.value.operation)
    }

    @Test
    fun `usb test and save retry permission instead of silently returning`() {
        usbDevices = listOf(usbDevice(hasPermission = false))
        openUsb()
        captureEffect { controller.selectCandidate(USB_DEVICE) }

        val testEffect = captureEffect { controller.test() }
        val saveEffect = captureEffect { controller.saveDraft() }

        assertEquals(PrinterDevicesEffect.RequestUsbPermission(USB_DEVICE), testEffect)
        assertEquals(PrinterDevicesEffect.RequestUsbPermission(USB_DEVICE), saveEffect)
        assertEquals(UsbPermissionState.REQUIRED, controller.state.value.usbPermissionState)
        assertEquals(
            context.getString(R.string.controller_usb_permission_required),
            controller.state.value.userMessage,
        )
    }

    @Test
    fun `missing usb device and missing draft are visible and recover operation`() {
        usbDevices = listOf(usbDevice(hasPermission = false))
        openUsb()
        captureEffect { controller.selectCandidate(USB_DEVICE) }
        usbDevices = emptyList()

        controller.test()
        scheduler.advanceUntilIdle()

        assertNull(controller.state.value.selectedCandidateId)
        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_usb_device_missing),
            controller.state.value.userMessage,
        )

        controller.refresh()
        scheduler.advanceUntilIdle()
        controller.saveDraft()
        scheduler.advanceUntilIdle()
        assertEquals(
            context.getString(R.string.controller_usb_select_printer),
            controller.state.value.userMessage,
        )
    }

    @Test
    fun `refresh clears stale usb and lan selections`() {
        usbDevices = listOf(usbDevice(hasPermission = true))
        openUsb()
        controller.selectCandidate(USB_DEVICE)
        scheduler.advanceUntilIdle()
        usbDevices = emptyList()

        controller.refresh()
        scheduler.advanceUntilIdle()

        assertNull(controller.state.value.selectedCandidateId)
        assertEquals(
            context.getString(R.string.controller_usb_device_missing),
            controller.state.value.userMessage,
        )

        lanDevices = listOf(lanDevice())
        openLan()
        controller.selectCandidate(LAN_ID)
        lanDevices = emptyList()
        controller.refresh()
        scheduler.advanceUntilIdle()
        assertNull(controller.state.value.selectedCandidateId)
        assertEquals(
            context.getString(R.string.controller_printer_list_updated),
            controller.state.value.userMessage,
        )
    }

    @Test
    fun `usb scan exception becomes visible and never leaves discovering active`() {
        usbScanFailure = IllegalStateException("scan failed")

        openUsb()

        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_usb_scan_failed),
            controller.state.value.userMessage,
        )
    }

    @Test
    fun `usb open endpoint and save failures use specific visible messages`() {
        usbDevices = listOf(usbDevice(hasPermission = true))
        openUsb()
        controller.selectCandidate(USB_DEVICE)
        scheduler.advanceUntilIdle()

        printBehavior = { _, _ ->
            PrintResult.Failure(code = UsbPrintErrorCode.USB_OPEN_FAILED)
        }
        controller.test()
        scheduler.advanceUntilIdle()
        assertEquals(
            context.getString(R.string.controller_usb_device_busy),
            controller.state.value.userMessage,
        )

        printBehavior = { _, _ ->
            PrintResult.Failure(code = UsbPrintErrorCode.USB_BULK_OUT_NOT_FOUND)
        }
        controller.test()
        scheduler.advanceUntilIdle()
        assertEquals(
            context.getString(R.string.controller_usb_endpoint_unavailable),
            controller.state.value.userMessage,
        )

        saveBehavior = { throw IllegalStateException("save failed") }
        controller.saveDraft()
        scheduler.advanceUntilIdle()
        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_printer_save_failed),
            controller.state.value.userMessage,
        )
    }

    @Test
    fun `lan operation guard provides feedback while buttons should be disabled`() {
        lanDevices = listOf(lanDevice())
        openLan()
        controller.selectCandidate(LAN_ID)
        val gate = CompletableDeferred<Unit>()
        printBehavior = { _, _ -> gate.await(); success() }

        controller.continueCurrentFlow()
        scheduler.runCurrent()
        assertEquals(PrinterOperation.TESTING, controller.state.value.operation)

        controller.continueCurrentFlow()
        assertEquals(
            context.getString(R.string.controller_operation_in_progress),
            controller.state.value.userMessage,
        )

        gate.complete(Unit)
        scheduler.advanceUntilIdle()
        assertEquals(PrinterOperation.SUCCESS, controller.state.value.operation)
    }

    @Test
    fun `lan test and save failures are specific and never leave loading active`() {
        lanDevices = listOf(lanDevice())
        openLan()
        controller.selectCandidate(LAN_ID)
        printBehavior = { _, _ ->
            PrintResult.Failure(code = UsbPrintErrorCode.LAN_CONNECT_FAILED)
        }

        controller.continueCurrentFlow()
        scheduler.advanceUntilIdle()
        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_lan_test_failed),
            controller.state.value.userMessage,
        )

        printBehavior = { _, _ -> success() }
        saveBehavior = { throw IllegalStateException("save failed") }
        controller.continueCurrentFlow()
        scheduler.advanceUntilIdle()
        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_printer_save_failed),
            controller.state.value.userMessage,
        )

        saveBehavior = {}
        printBehavior = { _, _ -> throw IllegalStateException("transport failed") }
        controller.continueCurrentFlow()
        scheduler.advanceUntilIdle()
        assertEquals(PrinterOperation.FAILURE, controller.state.value.operation)
        assertEquals(
            context.getString(R.string.controller_lan_test_failed),
            controller.state.value.userMessage,
        )
    }

    private fun openUsb() {
        controller.startAdd()
        controller.selectTransport(PrinterTransport.USB)
        controller.continueCurrentFlow()
        scheduler.advanceUntilIdle()
    }

    private fun openLan() {
        controller.startAdd()
        controller.selectTransport(PrinterTransport.LAN)
        controller.continueCurrentFlow()
        scheduler.advanceUntilIdle()
    }

    private fun captureEffect(action: () -> Unit): PrinterDevicesEffect {
        var captured: PrinterDevicesEffect? = null
        val collection = CoroutineScope(dispatcher).launch {
            captured = controller.effects.first()
        }
        scheduler.runCurrent()
        action()
        scheduler.advanceUntilIdle()
        collection.cancel()
        return requireNotNull(captured)
    }

    private fun usbDevice(hasPermission: Boolean) = UsbDeviceDescriptor(
        deviceName = USB_DEVICE,
        manufacturerName = "YunQiao",
        productName = "Target USB",
        vendorId = 0x0FE6,
        productId = 0x811E,
        deviceClass = 0,
        deviceSubclass = 0,
        deviceProtocol = 0,
        interfaces = listOf(
            UsbInterfaceDescriptor(
                index = 0,
                id = 0,
                alternateSetting = 0,
                interfaceClass = 7,
                interfaceSubclass = 1,
                interfaceProtocol = 2,
                endpoints = listOf(
                    UsbEndpointDescriptor(
                        address = 0x03,
                        endpointNumber = 3,
                        direction = UsbEndpointDirection.OUT,
                        type = UsbEndpointType.BULK,
                        maxPacketSize = 64,
                        interval = 0,
                    ),
                ),
            ),
        ),
        hasPermission = hasPermission,
    )

    private fun lanDevice() = PrinterCandidate(
        identifier = LAN_ID,
        displayName = "LAN Printer",
        channel = PrinterChannel.LOCAL_LAN_ESCPOS,
        likelyPrinter = true,
        connectionOptions = emptyList(),
    )

    private fun credential() = TerminalCredential(
        merchantId = "11",
        terminalId = "22",
        authorizationScheme = "Terminal",
        token = "t".repeat(24),
        tokenVersion = 1,
        tokenExpiresAt = Long.MAX_VALUE,
        heartbeatSeconds = 20,
        pollIntervalSeconds = 5,
        configVersion = 1,
    )

    private companion object {
        const val USB_DEVICE = "/dev/bus/usb/001/002"
        const val LAN_ID = "192.168.1.20:9100"
        const val TERMINAL_INSTANCE_ID = "terminal-instance-0001"

        fun success() = PrintResult.Success(plannedBytes = 1, writtenBytes = 1)
    }
}
