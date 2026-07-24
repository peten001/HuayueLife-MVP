package com.yunqiao.life.merchantterminal.connector

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.MainActivity
import com.yunqiao.life.merchantterminal.R
import com.yunqiao.life.merchantterminal.data.ConnectorSettings
import java.io.File
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
    fun `existing top-right time-area entry opens connector page and other content does not`() {
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

        assertTrue(mainActivitySource.contains("private fun configureTerminalMenu()"))
        assertTrue(mainActivitySource.contains("private fun configureSwipeRefresh()"))
        val terminalMenuBlock = mainActivitySource
            .substringAfter("private fun configureTerminalMenu()")
            .substringBefore("private fun configureSwipeRefresh()")
        assertTrue(cashierHeader.contains("class=\"top-status-item top-status-item--clock\""))
        val clockBlock = cashierHeader
            .substringAfter("class=\"top-status-item top-status-item--clock\"")
            .substringBefore("</div>")

        assertTrue(mainLayout.contains("android:id=\"@+id/terminal_menu_button\""))
        assertTrue(mainLayout.contains("android:layout_gravity=\"top|end\""))
        assertTrue(mainLayout.contains("android:layout_height=\"48dp\""))
        assertTrue(terminalMenuBlock.contains("binding.terminalMenuButton.setOnClickListener"))
        assertTrue(terminalMenuBlock.contains("MENU_CONNECTOR_CONTROL ->"))
        assertTrue(
            terminalMenuBlock.contains(
                "startActivity(Intent(this@MainActivity, ConnectorControlActivity::class.java))",
            ),
        )
        assertFalse(terminalMenuBlock.contains("binding.rootContainer.setOnClickListener"))
        assertTrue(
            mainActivitySource.windowed("ConnectorControlActivity::class.java".length)
                .count { it == "ConnectorControlActivity::class.java" } == 1,
        )

        assertTrue(clockBlock.contains("data-testid=\"top-clock\""))
        assertFalse(clockBlock.contains("@click"))
        val cashierPublicSource = repositoryDirectory("apps/merchant-cashier/src")
            .walkTopDown()
            .filter(File::isFile)
            .filter { it.extension in setOf("vue", "ts", "css") }
            .joinToString(separator = "\n") { it.readText() }
        assertFalse(cashierPublicSource.contains("USB打印连接器"))
        assertFalse(cashierPublicSource.contains("ConnectorControlActivity"))

        val connectorLayout = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/res/layout/activity_connector_control.xml",
        ).readText()
        assertFalse(connectorLayout.contains("SwitchMaterial"))
        assertFalse(connectorLayout.contains("connector_enabled_switch"))
        assertFalse(connectorLayout.contains("automatic_printing_switch"))
        assertFalse(connectorActivitySource.contains("setConnectorEnabled"))
        assertFalse(connectorActivitySource.contains("setAutomaticPrintingEnabled"))
        assertTrue(connectorActivitySource.contains("reconnectConnectorButton"))
    }

    @Test
    fun `close page only finishes hidden activity and reopening mirrors retained remote state`() {
        val settings = ConnectorSettings(context)
        try {
            runBlocking {
                settings.applyRemoteConfig(
                    merchantPrintingEnabled = true,
                    executionEnabled = true,
                    printerConfigured = true,
                    printerEnabled = true,
                    automaticPrintingEnabled = true,
                    pollIntervalMs = 7_000,
                    configRefreshIntervalMs = 30_000,
                )
            }

            val first = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
            try {
                first.get().findViewById<View>(R.id.close_connector_control_button).performClick()

                assertTrue(first.get().isFinishing)
                assertTrue(runBlocking { settings.snapshot().remoteMerchantPrintingEnabled })
            } finally {
                first.pause().stop().destroy()
            }

            val reopened = Robolectric.buildActivity(ConnectorControlActivity::class.java).setup()
            try {
                val retained = runBlocking { settings.snapshot() }
                reopened.get().renderConnectorControls(
                    connectorControlUi(snapshot = retained, serviceActive = true),
                )
                assertTrue(
                    reopened.get().findViewById<TextView>(R.id.platform_capability_value)
                        .text.toString().isNotBlank(),
                )
            } finally {
                reopened.pause().stop().destroy()
            }
        } finally {
            runBlocking { settings.disableForSignedOutSession() }
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
