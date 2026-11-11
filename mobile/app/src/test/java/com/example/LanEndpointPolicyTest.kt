package com.example

import com.example.network.privateLanIpv4OrNull
import com.example.network.remoteHostOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LanEndpointPolicyTest {
    @Test
    fun acceptsOnlyCanonicalPrivateOrLoopbackIpv4() {
        assertEquals("192.168.1.20", privateLanIpv4OrNull("192.168.001.020"))
        assertEquals("10.0.0.5", privateLanIpv4OrNull("10.0.0.5"))
        assertEquals("127.0.0.1", privateLanIpv4OrNull("127.0.0.1"))
        assertNull(privateLanIpv4OrNull("8.8.8.8"))
        assertNull(privateLanIpv4OrNull("192.168.1.20.attacker.example"))
        assertNull(privateLanIpv4OrNull("localhost"))
        assertNull(privateLanIpv4OrNull("256.1.1.1"))
    }

    @Test
    fun acceptsVpnPublicAndDnsEndpointsForPinnedConnections() {
        assertEquals("100.64.0.12", remoteHostOrNull("100.64.0.12"))
        assertEquals("203.0.113.42", remoteHostOrNull("203.0.113.42"))
        assertEquals("desktop.tail1234.ts.net", remoteHostOrNull(" Desktop.Tail1234.TS.NET. "))
        assertEquals("gaming-pc", remoteHostOrNull("gaming-pc"))
        assertNull(remoteHostOrNull("https://example.com"))
        assertNull(remoteHostOrNull("host/name"))
        assertNull(remoteHostOrNull("-invalid.example"))
        assertNull(remoteHostOrNull("0.0.0.0"))
        assertNull(remoteHostOrNull("224.0.0.1"))
    }
}
