package com.yunqiao.life.merchantterminal.printing.bluetooth

import org.junit.Assert.assertEquals
import org.junit.Test

class BluetoothDiscoveryStateResolverTest {
    @Test
    fun `enabled permission-ready adapter is distinguished from disabled adapter`() {
        assertEquals(
            BluetoothDiscoveryState.READY,
            resolve(permissionReady = true, adapterEnabled = true),
        )
        assertEquals(
            BluetoothDiscoveryState.DISABLED,
            resolve(permissionReady = true, adapterEnabled = false),
        )
    }

    @Test
    fun `permission denial is not misreported as an empty scan`() {
        assertEquals(
            BluetoothDiscoveryState.PERMISSION_DENIED,
            resolve(permissionReady = false, adapterEnabled = true),
        )
        assertEquals(
            BluetoothDiscoveryState.EMPTY,
            BluetoothDiscoveryStateResolver.resolve(
                adapterAvailable = true,
                permissionReady = true,
                adapterEnabled = true,
                hasCandidates = false,
                discoveryFinished = true,
            ),
        )
    }

    private fun resolve(
        permissionReady: Boolean,
        adapterEnabled: Boolean,
    ): BluetoothDiscoveryState = BluetoothDiscoveryStateResolver.resolve(
        adapterAvailable = true,
        permissionReady = permissionReady,
        adapterEnabled = adapterEnabled,
        hasCandidates = false,
        discoveryFinished = false,
    )
}
