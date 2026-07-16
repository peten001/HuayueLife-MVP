package com.yunqiao.life.merchantterminal.connector

import android.R.attr.state_checked
import android.R.attr.state_enabled
import android.graphics.Rect
import android.view.View
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.google.android.material.switchmaterial.SwitchMaterial
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettingsSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
@Config(qualifiers = "w1280dp-h800dp-land")
class ConnectorControlLandscapeUiTest {
    @Test
    fun `connector boolean and click action are never inverted`() {
        val online = connectorControlUi(
            snapshot = snapshot(
                connectorEnabled = true,
                remoteExecutionEnabled = true,
                remotePrinterEnabled = true,
            ),
            serviceActive = true,
        )
        val off = connectorControlUi(snapshot = snapshot(), serviceActive = false)

        assertTrue(online.checked)
        assertEquals(ConnectorVisualState.ONLINE, online.state)
        assertFalse(off.checked)
        assertEquals(ConnectorVisualState.OFF, off.state)
        assertEquals(ConnectorToggleAction.ENABLE, connectorToggleAction(checked = true))
        assertEquals(ConnectorToggleAction.DISABLE, connectorToggleAction(checked = false))
    }

    @Test
    fun `starting and failure states are explicit without changing connector gates`() {
        assertEquals(
            ConnectorVisualState.STARTING,
            connectorControlUi(
                snapshot = snapshot(connectorEnabled = false),
                serviceActive = false,
                startPending = true,
            ).state,
        )
        assertEquals(
            ConnectorVisualState.STARTING,
            connectorControlUi(
                snapshot = snapshot(
                    connectorEnabled = true,
                    lastErrorCode = "PRINTER_STATUS_NOT_READY",
                ),
                serviceActive = true,
            ).state,
        )
        val failed = connectorControlUi(
            snapshot = snapshot(connectorEnabled = false),
            serviceActive = false,
            transientErrorCode = "CONNECTOR_ENABLE_BLOCKED",
        )
        assertEquals(ConnectorVisualState.FAILED, failed.state)
        assertEquals("CONNECTOR_ENABLE_BLOCKED", failed.errorCode)

        withActivity { activity ->
            val state = activity.findViewById<TextView>(R.id.connector_state_text)
            activity.renderConnectorControls(failed)
            assertEquals("启动失败：CONNECTOR_ENABLE_BLOCKED", state.text.toString())
        }
    }

    @Test
    fun `positive snapshot renders checked green online and false renders gray off`() {
        withActivity { activity ->
            val connector = activity.findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
            val state = activity.findViewById<TextView>(R.id.connector_state_text)
            val primary = ContextCompat.getColor(activity, R.color.terminal_primary)
            val gray = ContextCompat.getColor(activity, R.color.terminal_text_secondary)
            val trackColors = requireNotNull(connector.trackTintList)

            activity.renderConnectorControls(
                connectorControlUi(
                    snapshot = snapshot(
                        connectorEnabled = true,
                        remoteExecutionEnabled = true,
                        remotePrinterEnabled = true,
                    ),
                    serviceActive = true,
                ),
            )
            assertTrue(connector.isChecked)
            assertEquals(activity.getString(R.string.connector_state_online), state.text.toString())
            assertEquals(
                primary,
                trackColors.getColorForState(
                    intArrayOf(state_enabled, state_checked),
                    trackColors.defaultColor,
                ),
            )

            activity.renderConnectorControls(
                connectorControlUi(snapshot = snapshot(), serviceActive = false),
            )
            assertFalse(connector.isChecked)
            assertEquals(activity.getString(R.string.connector_state_off), state.text.toString())
            assertEquals(
                gray,
                trackColors.getColorForState(
                    intArrayOf(state_enabled, -state_checked),
                    trackColors.defaultColor,
                ),
            )
        }
    }

    @Test
    fun `programmatic status refresh restores callback guard and keeps switch interactive`() {
        withActivity { activity ->
            val connector = activity.findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
            val callbackGuard = ConnectorControlActivity::class.java
                .getDeclaredField("suppressSwitchCallbacks")
                .apply { isAccessible = true }

            activity.renderConnectorControls(
                connectorControlUi(
                    snapshot = snapshot(connectorEnabled = true),
                    serviceActive = false,
                ),
            )

            assertTrue(connector.isChecked)
            assertFalse(callbackGuard.getBoolean(activity))
            assertTrue(connector.isEnabled)
            assertTrue(connector.isClickable)
        }
    }

    @Test
    fun `1280 by 800 landscape keeps large connector control visible away from right edge`() {
        withActivity { activity ->
            val root = activity.findViewById<View>(R.id.connector_control_root)
            val row = activity.findViewById<View>(R.id.connector_toggle_row)
            val label = activity.findViewById<View>(R.id.connector_enabled_label)
            val connector = activity.findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
            val state = activity.findViewById<View>(R.id.connector_state_text)
            val automaticRow = activity.findViewById<View>(R.id.automatic_toggle_row)
            val automatic = activity.findViewById<SwitchMaterial>(R.id.automatic_printing_switch)
            val close = activity.findViewById<View>(R.id.close_connector_control_button)
            val width = dp(activity, 1_280)
            val height = dp(activity, 800)

            root.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
            )
            root.layout(0, 0, width, height)

            assertTrue(row.visibility == View.VISIBLE)
            assertTrue(row.hasOnClickListeners())
            assertTrue(row.height >= dp(activity, 48))
            assertFullyVisible(row, width, height)
            assertFullyVisible(label, width, height)
            assertTrue(connector.isClickable)
            assertTrue(connector.isFocusable)
            assertTrue(connector.width >= dp(activity, 48))
            assertFullyVisible(connector, width, height)
            assertTrue(connector.right <= state.left)
            assertTrue(state.right < width)
            assertFullyVisible(state, width, height)
            assertFullyVisible(automaticRow, width, height)
            assertFalse(automatic.isEnabled)
            assertFalse(automatic.isClickable)
            assertFalse(automatic.isChecked)
            assertFullyVisible(close, width, height)
            assertEquals(
                activity.getString(R.string.connector_close_page),
                activity.findViewById<TextView>(R.id.close_connector_control_button).text.toString(),
            )
        }
    }

    @Test
    @Config(qualifiers = "w640dp-h400dp-land")
    fun `compact landscape keeps connector row and switch visible`() {
        withActivity { activity ->
            val root = activity.findViewById<View>(R.id.connector_control_root)
            val row = activity.findViewById<View>(R.id.connector_toggle_row)
            val label = activity.findViewById<View>(R.id.connector_enabled_label)
            val connector = activity.findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
            val state = activity.findViewById<View>(R.id.connector_state_text)
            val automatic = activity.findViewById<SwitchMaterial>(R.id.automatic_printing_switch)
            val close = activity.findViewById<View>(R.id.close_connector_control_button)
            val width = dp(activity, 640)
            val height = dp(activity, 400)

            root.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
            )
            root.layout(0, 0, width, height)

            assertFullyVisible(row, width, height)
            assertTrue(row.height >= dp(activity, 48))
            assertFullyVisible(label, width, height)
            assertFullyVisible(connector, width, height)
            assertTrue(connector.width >= dp(activity, 48))
            assertFullyVisible(state, width, height)
            assertFullyVisible(close, width, height)
            assertFalse(automatic.isEnabled)
            assertFalse(automatic.isClickable)
            assertFalse(automatic.isChecked)
        }
    }

    private inline fun withActivity(block: (ConnectorControlActivity) -> Unit) {
        val controller = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
        try {
            block(controller.get())
        } finally {
            controller.pause().stop().destroy()
        }
    }

    private fun snapshot(
        connectorEnabled: Boolean = false,
        remoteExecutionEnabled: Boolean = false,
        remotePrinterEnabled: Boolean = false,
        lastErrorCode: String? = null,
    ) = ConnectorSettingsSnapshot(
        connectorEnabled = connectorEnabled,
        remoteExecutionEnabled = remoteExecutionEnabled,
        remotePrinterEnabled = remotePrinterEnabled,
        lastErrorCode = lastErrorCode,
    )

    private fun dp(activity: ConnectorControlActivity, value: Int): Int =
        (value * activity.resources.displayMetrics.density).toInt()

    private fun assertFullyVisible(view: View, viewportWidth: Int, viewportHeight: Int) {
        val bounds = Rect()
        assertTrue(view.getGlobalVisibleRect(bounds))
        assertEquals(view.width, bounds.width())
        assertEquals(view.height, bounds.height())
        assertTrue(bounds.left >= 0)
        assertTrue(bounds.top >= 0)
        assertTrue(bounds.right <= viewportWidth)
        assertTrue(bounds.bottom <= viewportHeight)
    }
}
