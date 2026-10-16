package com.example

import com.example.ui.screens.parseAetherPairingQr
import com.example.ui.screens.PairingQrScanDecision
import com.example.ui.screens.PairingQrScanGate
import com.example.ui.screens.withRemoteEndpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PairingQrTest {
    @Test
    fun parsesTwelveDigitSecurePairingCode() {
        val fingerprint = "SHA256:${"AB".repeat(32)}"
        val payload = parseAetherPairingQr("aether://192.168.1.42:8080?pin=001042654321&tlsFingerprint=$fingerprint")
        assertEquals("001042654321", payload?.pin)
        assertEquals(fingerprint, payload?.tlsFingerprint)
    }

    @Test
    fun parsesHostQrPayload() {
        val payload = parseAetherPairingQr("aether://192.168.1.42:8080?pin=001042693")
        assertEquals("192.168.1.42", payload?.host)
        assertEquals(8080, payload?.port)
        assertEquals("001042693", payload?.pin)
        assertNull(payload?.tlsFingerprint)
    }

    @Test
    fun rejectsForeignAndInvalidQrPayloads() {
        assertNull(parseAetherPairingQr("https://example.com/?pin=001042693"))
        assertNull(parseAetherPairingQr("aether://192.168.1.42:8080?pin=123"))
        assertNull(parseAetherPairingQr("aether://192.168.1.42:99999?pin=001042693"))
        assertNull(parseAetherPairingQr("aether://192.168.1.42.attacker.example:8080?pin=001042693"))
        assertNull(parseAetherPairingQr("aether://192.168.1.42:8080?pin=001042693&tlsFingerprint=bad"))
    }

    @Test
    fun parsesPinnedTlsFingerprintFromQrPayload() {
        val fingerprint = "SHA256:${"AB".repeat(32)}"
        val payload = parseAetherPairingQr("aether://192.168.1.42:8080?pin=001042693&tlsFingerprint=$fingerprint")
        assertEquals(fingerprint, payload?.tlsFingerprint)
    }

    @Test
    fun parsesPinnedRemoteDnsAndPublicAddressQrPayloads() {
        val fingerprint = "SHA256:${"CD".repeat(32)}"
        val dns = parseAetherPairingQr("aether://desktop.tail1234.ts.net:8080?pin=001042693&tlsFingerprint=$fingerprint")
        val publicIp = parseAetherPairingQr("aether://203.0.113.42:8080?pin=001042693&tlsFingerprint=$fingerprint")

        assertEquals("desktop.tail1234.ts.net", dns?.host)
        assertEquals("203.0.113.42", publicIp?.host)
    }

    @Test
    fun keepsQrIdentityWhenVpnEndpointOverridesLanAddress() {
        val fingerprint = "SHA256:${"EF".repeat(32)}"
        val payload = com.example.ui.screens.PairingQrPayload("192.168.1.42", 8080, "001042693", fingerprint)

        assertEquals(
            payload.copy(host = "100.64.0.12", port = 8443),
            payload.withRemoteEndpoint("100.64.0.12", "8443")
        )
        assertNull(payload.withRemoteEndpoint("https://invalid.example", "8080"))
        assertNull(payload.withRemoteEndpoint("100.64.0.12", "99999"))
    }

    @Test
    fun scanGateAcceptsOnceAndCanBeReset() {
        val gate = PairingQrScanGate()
        val raw = "aether://192.168.1.42:8080?pin=001042693"

        val first = gate.consume(raw, 1_000L)
        assertEquals(
            PairingQrScanDecision.Accepted(
                com.example.ui.screens.PairingQrPayload("192.168.1.42", 8080, "001042693", null)
            ),
            first
        )
        assertEquals(PairingQrScanDecision.Ignored, gate.consume(raw, 1_001L))

        gate.reset()
        assertEquals(true, gate.consume(raw, 2_000L) is PairingQrScanDecision.Accepted)
    }

    @Test
    fun scanGateThrottlesRepeatedInvalidFrames() {
        val gate = PairingQrScanGate()
        val raw = "https://example.com"

        assertEquals(PairingQrScanDecision.Invalid, gate.consume(raw, 1_000L))
        assertEquals(PairingQrScanDecision.Ignored, gate.consume(raw, 1_500L))
        assertEquals(PairingQrScanDecision.Invalid, gate.consume(raw, 3_000L))
    }
}
