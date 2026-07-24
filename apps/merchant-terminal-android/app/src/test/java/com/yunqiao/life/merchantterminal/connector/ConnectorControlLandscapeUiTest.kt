package com.yunqiao.life.merchantterminal.connector

import android.content.pm.ActivityInfo
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import com.yunqiao.life.merchantterminal.data.UsbPrinterBinding
import com.yunqiao.life.merchantterminal.printing.CutMode
import com.yunqiao.life.merchantterminal.printing.PaperWidth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
@Config(qualifiers = "w1366dp-h768dp-land")
class ConnectorControlLandscapeUiTest {
    @Test
    fun `connector page is landscape read-only status with recovery actions`() {
        val activity = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup().get()
        val activityInfo = ApplicationProvider.getApplicationContext<android.content.Context>()
            .packageManager.getActivityInfo(activity.componentName, 0)

        assertEquals(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE, activityInfo.screenOrientation)
        listOf(
            R.id.platform_capability_value,
            R.id.merchant_configuration_value,
            R.id.usb_connection_value,
            R.id.automatic_printing_value,
            R.id.last_connection_value,
            R.id.last_error_value,
            R.id.refresh_connector_status_button,
            R.id.reconnect_connector_button,
            R.id.open_usb_diagnostics_button,
        ).forEach { id -> assertNotNull(activity.findViewById<View>(id)) }

        val source = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/java/" +
                "com/yunqiao/life/merchantterminal/connector/ConnectorControlActivity.kt",
        ).readText()
        val layout = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/res/layout/activity_connector_control.xml",
        ).readText()
        assertFalse(source.contains("setConnectorEnabled"))
        assertFalse(source.contains("setAutomaticPrintingEnabled"))
        assertFalse(layout.contains("SwitchMaterial"))
    }

    @Test
    fun `capability configuration connection and automatic states remain independent`() {
        val snapshot = eligibleSnapshot()

        val connected = connectorControlUi(
            snapshot = snapshot,
            serviceActive = true,
            usbResolutionCode = "USB_READY",
        )
        assertEquals(ConnectorCapabilityState.ENABLED, connected.capability)
        assertEquals(ConnectorConfigurationState.CONFIGURED, connected.configuration)
        assertEquals(ConnectorConnectionState.CONNECTED, connected.connection)
        assertEquals(ConnectorAutomaticState.ENABLED, connected.automaticPrinting)

        val unplugged = connectorControlUi(
            snapshot = snapshot,
            serviceActive = false,
            usbResolutionCode = "USB_DEVICE_NOT_FOUND",
        )
        assertEquals(ConnectorCapabilityState.ENABLED, unplugged.capability)
        assertEquals(ConnectorConfigurationState.CONFIGURED, unplugged.configuration)
        assertEquals(ConnectorConnectionState.NOT_DETECTED, unplugged.connection)

        val waiting = connectorControlUi(
            snapshot = snapshot,
            serviceActive = true,
            usbResolutionCode = "USB_PERMISSION_REQUIRED",
        )
        assertEquals(ConnectorConnectionState.WAITING_PERMISSION, waiting.connection)
    }

    @Test
    fun `legacy switches cannot make unknown remote authority executable`() {
        val legacyOnly = ConnectorSettingsSnapshot(
            connectorEnabled = true,
            automaticPrintingEnabled = true,
            usbBinding = binding(),
        )

        assertFalse(legacyOnly.canExecute)
        assertFalse(legacyOnly.canClaimAutomatic)
        val ui = connectorControlUi(legacyOnly, serviceActive = false)
        assertEquals(ConnectorCapabilityState.UNKNOWN, ui.capability)
        assertEquals(ConnectorConfigurationState.UNKNOWN, ui.configuration)
        assertEquals(ConnectorAutomaticState.UNKNOWN, ui.automaticPrinting)
    }

    @Test
    fun `rendered status never labels configured as online`() {
        val controller = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
        try {
            val activity = controller.get()
            activity.renderConnectorControls(
                connectorControlUi(
                    snapshot = eligibleSnapshot(),
                    serviceActive = false,
                    usbResolutionCode = "USB_DEVICE_NOT_FOUND",
                ),
            )

            assertEquals(
                activity.getString(R.string.connector_configuration_configured),
                activity.findViewById<TextView>(R.id.merchant_configuration_value).text.toString(),
            )
            assertEquals(
                activity.getString(R.string.connector_connection_not_detected),
                activity.findViewById<TextView>(R.id.usb_connection_value).text.toString(),
            )
        } finally {
            controller.pause().stop().destroy()
        }
    }

    private fun eligibleSnapshot() = ConnectorSettingsSnapshot(
        remoteConfigKnown = true,
        remoteMerchantPrintingEnabled = true,
        remoteExecutionEnabled = true,
        remotePrinterConfigured = true,
        remotePrinterEnabled = true,
        remoteAutomaticPrintingEnabled = true,
        usbBinding = binding(),
        lastSuccessfulConnectionAt = 1_234L,
        lastErrorCode = "USB_DEVICE_NOT_FOUND",
    )

    private fun binding() = UsbPrinterBinding(
        printerId = "9",
        deviceName = "/dev/bus/usb/001/002",
        vendorId = 1,
        productId = 2,
        interfaceIndex = 0,
        interfaceId = 0,
        alternateSetting = 0,
        endpointAddress = 1,
        paperWidth = PaperWidth.MM_80,
        customDots = null,
        threshold = 160,
        cutMode = CutMode.NONE,
    )

    private fun repositoryFile(relativePath: String): java.io.File {
        val workingDirectory = requireNotNull(System.getProperty("user.dir"))
        return generateSequence(java.io.File(workingDirectory)) { it.parentFile }
            .map { root -> java.io.File(root, relativePath) }
            .firstOrNull(java.io.File::exists)
            ?: error("Repository path not found: $relativePath")
    }
}
