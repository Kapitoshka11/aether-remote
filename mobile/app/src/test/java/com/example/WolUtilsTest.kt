package com.example

import com.example.network.WolUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WolUtilsTest {
    @Test
    fun buildsExactMagicPacketAndRejectsInvalidHex() {
        val packet = WolUtils.buildMagicPacket("AA-BB-01-02-FE-FF")
        assertEquals(102, packet.size)
        assertTrue(packet.take(6).all { it == 0xff.toByte() })
        assertEquals("aabb0102feff", packet.copyOfRange(6, 12).joinToString("") { "%02x".format(it.toInt() and 0xff) })
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { WolUtils.buildMagicPacket("GG:BB:01:02:03:04") }
        org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { WolUtils.buildMagicPacket("") }
    }

    @Test
    fun computesDirectedBroadcastForActiveSubnet() {
        assertEquals("192.168.1.255", WolUtils.directedBroadcastAddress("192.168.1.42", 24))
        assertEquals("10.0.3.255", WolUtils.directedBroadcastAddress("10.0.2.15", 23))
        assertEquals("255.255.255.255", WolUtils.directedBroadcastAddress("192.168.1.42", 32))
        assertEquals(null, WolUtils.directedBroadcastAddress("invalid", 24))
    }
}
