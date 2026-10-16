package com.example

import android.net.NetworkCapabilities
import com.example.network.buildReconnectNetworkRequest
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ReconnectNetworkRequestTest {
    @Test
    fun `reconnect observer includes VPN and local only networks`() {
        val capabilities = ReflectionHelpers.getField<NetworkCapabilities>(
            buildReconnectNetworkRequest(),
            "networkCapabilities"
        )

        assertFalse(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN))
        assertFalse(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
    }
}
