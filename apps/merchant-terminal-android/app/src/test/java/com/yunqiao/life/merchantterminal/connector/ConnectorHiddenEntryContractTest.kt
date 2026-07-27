package com.yunqiao.life.merchantterminal.connector

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.View
import androidx.test.core.app.ApplicationProvider
import com.google.android.material.switchmaterial.SwitchMaterial
import com.yunqiao.life.merchantterminal.MainActivity
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ConnectorHiddenEntryContractTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `version entry hides diagnostics and only opens the USB page through the protected path`() {
        // MainActivity owns a real WebView, which Robolectric cannot reliably create on every
        // SDK image. Keep this as a source/layout contract so the existing hidden entry cannot
        // accidentally move into the public cashier UI while this page is refined.
        val mainActivitySource = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/java/" +
                "com/yunqiao/life/merchantterminal/MainActivity.kt",
        ).readText()
        val mainLayout = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/res/layout/activity_main.xml",
        ).readText()
        val connectorActivitySource = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/java/" +
                "com/yunqiao/life/merchantterminal/connector/ConnectorControlActivity.kt",
        ).readText()
        val cashierHeader = repositoryFile(
            "apps/merchant-cashier/src/components/shell/CashierHeader.vue",
        ).readText()

        assertTrue(mainActivitySource.contains("private fun configureVersionUnlock()"))
        assertTrue(mainActivitySource.contains("private fun configureSwipeRefresh()"))
        val versionUnlockBlock = mainActivitySource
            .substringAfter("private fun configureVersionUnlock()")
            .substringBefore("private fun configureSwipeRefresh()")
        assertTrue(cashierHeader.contains("class=\"top-status-item top-status-item--clock\""))
        val clockBlock = cashierHeader
            .substringAfter("class=\"top-status-item top-status-item--clock\"")
            .substringBefore("</div>")

        assertTrue(mainLayout.contains("android:id=\"@+id/app_version\""))
        assertTrue(mainLayout.contains("android:layout_gravity=\"top|end\""))
        assertTrue(mainLayout.contains("android:layout_height=\"48dp\""))
        assertFalse(mainLayout.contains("terminal_menu_button"))
        assertTrue(versionUnlockBlock.contains("binding.appVersion.setOnClickListener"))
        assertTrue(versionUnlockBlock.contains("merchantSessionTokenStore.hasCredential()"))
        assertTrue(versionUnlockBlock.contains("versionTapUnlock.registerTap(SystemClock.elapsedRealtime())"))
        assertTrue(
            versionUnlockBlock.contains(
                "startActivity(Intent(this, UsbPrinterDiagnosticsActivity::class.java))",
            ),
        )
        assertFalse(mainActivitySource.contains("PopupMenu"))
        assertFalse(mainActivitySource.contains("ConnectorControlActivity::class.java"))
        assertFalse(mainActivitySource.contains("Intent(this, DiagnosticsActivity::class.java)"))
        assertTrue(
            mainActivitySource.windowed("versionTapUnlock.reset()".length)
                .count { it == "versionTapUnlock.reset()" } >= 4,
        )
        val errorLayout = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/res/layout/view_error_state.xml",
        ).readText()
        assertFalse(errorLayout.contains("diagnostics_button"))

        assertTrue(clockBlock.contains("data-testid=\"top-clock\""))
        assertFalse(clockBlock.contains("@click"))
        val cashierPublicSource = repositoryDirectory("apps/merchant-cashier/src")
            .walkTopDown()
            .filter(File::isFile)
            .filter { it.extension in setOf("vue", "ts", "css") }
            .joinToString(separator = "\n") { it.readText() }
        assertFalse(cashierPublicSource.contains("USB打印连接器"))
        assertFalse(cashierPublicSource.contains("ConnectorControlActivity"))

        val switchListenerBlock = connectorActivitySource
            .substringAfter("binding.connectorEnabledSwitch.setOnCheckedChangeListener")
            .substringBefore("// This UI-only refinement")
        assertTrue(switchListenerBlock.contains("ConnectorToggleAction.ENABLE"))
        assertTrue(switchListenerBlock.contains("requestEnableConnector()"))
        assertTrue(switchListenerBlock.contains("ConnectorToggleAction.DISABLE"))
        assertTrue(switchListenerBlock.contains("disableConnector()"))
        assertFalse(switchListenerBlock.contains("!checked"))
        assertFalse(switchListenerBlock.contains("!enabled"))
        assertFalse(switchListenerBlock.contains("setConnectorEnabled(!"))
    }

    @Test
    fun `close page only finishes hidden activity and reopening mirrors retained connector state`() {
        val settings = ConnectorSettings(context)
        try {
            runBlocking(Dispatchers.IO) { settings.setConnectorEnabled(true) }

            val first = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
            try {
                val snapshot = runBlocking(Dispatchers.IO) { settings.snapshot() }
                first.get().renderConnectorControls(
                    connectorControlUi(snapshot = snapshot, serviceActive = true),
                )
                assertTrue(
                    first.get()
                        .findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
                        .isChecked,
                )

                first.get().findViewById<View>(R.id.close_connector_control_button).performClick()

                assertTrue(first.get().isFinishing)
                assertTrue(runBlocking(Dispatchers.IO) { settings.snapshot().connectorEnabled })
            } finally {
                first.pause().stop().destroy()
            }

            val reopened = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
            try {
                val retained = runBlocking(Dispatchers.IO) { settings.snapshot() }
                reopened.get().renderConnectorControls(
                    connectorControlUi(snapshot = retained, serviceActive = true),
                )
                assertTrue(
                    reopened.get()
                        .findViewById<SwitchMaterial>(R.id.connector_enabled_switch)
                        .isChecked,
                )
            } finally {
                reopened.pause().stop().destroy()
            }
        } finally {
            runBlocking(Dispatchers.IO) { settings.setConnectorEnabled(false) }
        }
    }

    @Suppress("DEPRECATION")
    @Test
    fun `connector page is not a launcher or exported public entry`() {
        val packageManager = context.packageManager
        val connector = packageManager.getActivityInfo(
            ComponentName(context, ConnectorControlActivity::class.java),
            PackageManager.GET_META_DATA,
        )
        assertFalse(connector.exported)

        val mainFilters = shadowOf(packageManager).getIntentFiltersForActivity(
            ComponentName(context, MainActivity::class.java),
        )
        assertTrue(
            mainFilters.any { filter ->
                filter.hasAction(Intent.ACTION_MAIN) &&
                    filter.hasCategory(Intent.CATEGORY_LAUNCHER)
            },
        )
        assertTrue(
            shadowOf(packageManager).getIntentFiltersForActivity(
                ComponentName(context, ConnectorControlActivity::class.java),
            ).isEmpty(),
        )
    }

    private fun repositoryFile(relativePath: String): File {
        val file = repositoryPath(relativePath)
        check(file.isFile) { "Repository file not found: $relativePath" }
        return file
    }

    private fun repositoryDirectory(relativePath: String): File {
        val directory = repositoryPath(relativePath)
        check(directory.isDirectory) { "Repository directory not found: $relativePath" }
        return directory
    }

    private fun repositoryPath(relativePath: String): File {
        val workingDirectory = requireNotNull(System.getProperty("user.dir"))
        return generateSequence(File(workingDirectory)) { it.parentFile }
            .map { root -> File(root, relativePath) }
            .firstOrNull(File::exists)
            ?: error("Repository path not found: $relativePath")
    }
}
