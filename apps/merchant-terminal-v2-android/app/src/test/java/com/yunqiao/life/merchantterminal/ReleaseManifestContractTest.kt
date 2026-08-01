package com.yunqiao.life.merchantterminal

import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ReleaseManifestContractTest {
    @Test
    fun manifestHasOneConnectorServiceAndNoDiagnosticComponents() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_ACTIVITIES or
                PackageManager.GET_SERVICES or
                PackageManager.GET_RECEIVERS,
        )
        val componentNames = buildList {
            info.activities.orEmpty().mapTo(this) { it.name }
            info.services.orEmpty().mapTo(this) { it.name }
            info.receivers.orEmpty().mapTo(this) { it.name }
        }
        assertFalse(componentNames.any { it.contains("diagnostic", ignoreCase = true) })
        assertEquals(
            1,
            info.services.orEmpty().count { it.name.endsWith(".V2PrinterService") },
        )
        assertTrue(info.activities.orEmpty().any { it.name.endsWith(".MainActivity") })
    }
}
