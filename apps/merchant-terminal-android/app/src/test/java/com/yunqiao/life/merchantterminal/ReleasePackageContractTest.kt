package com.yunqiao.life.merchantterminal

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
        assertEquals("1.0.0-rc2", BuildConfig.VERSION_NAME)
        assertEquals(6, BuildConfig.VERSION_CODE)
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
    fun `manifest exposes only the current USB connector control activity`() {
        val packageInfo = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_ACTIVITIES,
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
}
