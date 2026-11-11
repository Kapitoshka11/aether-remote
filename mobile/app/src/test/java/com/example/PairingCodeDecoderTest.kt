package com.example

import com.example.network.decodePairingHostIp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingCodeDecoderTest {
    @Test
    fun combinesLocalSubnetWithValidatedCodeOctets() {
        assertEquals("192.168.1.105", decodePairingHostIp("001105654321", "192.168."))
        assertEquals("192.168.1.105", decodePairingHostIp("001105777", "192.168."))
        assertEquals("10.0.168.105", decodePairingHostIp("168105777", "10.0."))
        assertNull(decodePairingHostIp("999105777", "192.168."))
        assertNull(decodePairingHostIp("001105777", "invalid."))
    }
}
