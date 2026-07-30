package com.yunqiao.life.merchantterminal

import android.content.ComponentName
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import com.yunqiao.life.merchantterminal.connector.ConnectorApiConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReleasePackageContractTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `release uses the fixed production Web and merchant connector contract`() {
        assumeTrue(BuildConfig.BUILD_TYPE == "release")

        assertEquals("com.yunqiao.life.merchantterminal", BuildConfig.APPLICATION_ID)
        assertEquals("1.0.0-rc6.2", BuildConfig.VERSION_NAME)
        assertEquals(20, BuildConfig.VERSION_CODE)
        assertEquals("云桥 Life 商家终端", context.applicationInfo.loadLabel(context.packageManager))
        assertEquals("https://cashier.huayueyouxuan.com/", BuildConfig.CASHIER_WEB_URL)
        assertEquals("https://cashier.huayueyouxuan.com", BuildConfig.TRUSTED_PAGE_ORIGIN)
        assertEquals("api.huayueyouxuan.com", BuildConfig.TRUSTED_RESOURCE_HOSTS)
        assertEquals("https://api.huayueyouxuan.com/api/v1", BuildConfig.CONNECTOR_API_BASE_URL)
        assertEquals(
            "https://api.huayueyouxuan.com/api/v1/merchant/printing/connector/config",
            ConnectorApiConfig.endpoint("/merchant/printing/connector/config"),
        )
        assertFalse(BuildConfig.DEBUG)
    }

    @Suppress("DEPRECATION")
    @Test
    fun `manifest exposes one enabled launcher and keeps connector control private`() {
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_ACTIVITIES,
        )
        val mainActivity = context.packageManager.getActivityInfo(
            ComponentName(context, MainActivity::class.java),
            PackageManager.GET_META_DATA,
        )
        assertTrue(mainActivity.enabled)
        assertTrue(mainActivity.exported)
        assertEquals(
            MainActivity::class.java.name,
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.component?.className,
        )

        val connectorActivities = packageInfo.activities.orEmpty()
            .map { it.name }
            .filter { it.startsWith("com.yunqiao.life.merchantterminal.connector.") }

        assertEquals(
            listOf("com.yunqiao.life.merchantterminal.connector.ConnectorControlActivity"),
            connectorActivities,
        )
        if (BuildConfig.BUILD_TYPE == "release") {
            val applicationInfo = requireNotNull(packageInfo.applicationInfo)
            assertTrue(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0)
        }
    }

    @Test
    fun `clean RC6 point 1 has no temporary bottom buttons and keeps USB page private`() {
        val source = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/java/" +
                "com/yunqiao/life/merchantterminal/security/MerchantSessionTokenStore.kt",
        ).readText()
        val layout = repositoryFile(
            "apps/merchant-terminal-android/app/src/main/res/layout/activity_main.xml",
        ).readText()
        assertTrue(source.contains("employee-menu-popover"))
        assertTrue(source.contains("data-yunqiao-printer-settings"))
        assertTrue(source.contains("OPEN_PRINTER_SETTINGS"))
        assertFalse(layout.contains("usb_diagnostics_hotfix_button"))
        assertFalse(layout.contains("usb_connector_hotfix_button"))
    }

    private fun repositoryFile(relativePath: String): java.io.File {
        val workingDirectory = requireNotNull(System.getProperty("user.dir"))
        return generateSequence(java.io.File(workingDirectory)) { it.parentFile }
            .map { root -> java.io.File(root, relativePath) }
            .firstOrNull(java.io.File::isFile)
            ?: error("Repository file not found: $relativePath")
    }
}
