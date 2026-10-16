package com.example

import com.example.wake.WakeRequest
import com.example.wake.canonicalizeWakeRequest
import com.example.wake.signWakeRequest
import com.example.wake.validateWakeRequest
import com.example.wake.verifyWakeRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.security.KeyPairGenerator

@RunWith(RobolectricTestRunner::class)
class WakeProtocolTest {
    @Test
    fun canonicalRequestMatchesProtocolV1Literal() {
        val request = WakeRequest(
            groupId = "00112233445566778899aabbccddeeff",
            targetDeviceId = "11112222333344445555666677778888",
            senderDeviceId = "9999aaaabbbbccccddddeeeeffff0000",
            nonce = "0123456789abcdeffedcba9876543210",
            issuedAt = 1_700_000_000_000,
            expiresAt = 1_700_000_030_000
        )
        val expected = listOf(
            "AETHER_WAKE/1",
            "type=wake.request",
            "groupId=00112233445566778899aabbccddeeff",
            "targetDeviceId=11112222333344445555666677778888",
            "senderDeviceId=9999aaaabbbbccccddddeeeeffff0000",
            "nonce=0123456789abcdeffedcba9876543210",
            "issuedAt=1700000000000",
            "expiresAt=1700000030000"
        ).joinToString("\n")

        assertEquals(expected, canonicalizeWakeRequest(request).toString(Charsets.UTF_8))
    }

    @Test
    fun signatureRejectsAlteredAndExpiredRequests() {
        val keys = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val request = WakeRequest(
            groupId = "00112233445566778899aabbccddeeff",
            targetDeviceId = "11112222333344445555666677778888",
            senderDeviceId = "9999aaaabbbbccccddddeeeeffff0000",
            nonce = "0123456789abcdeffedcba9876543210",
            issuedAt = 1_700_000_000_000,
            expiresAt = 1_700_000_030_000
        )
        val signed = signWakeRequest(request, keys.private)

        assertNull(validateWakeRequest(signed, request.issuedAt))
        assertTrue(verifyWakeRequest(signed, keys.public, request.issuedAt))
        assertFalse(
            verifyWakeRequest(
                signed.copy(targetDeviceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                keys.public,
                request.issuedAt
            )
        )
        assertEquals("expired", validateWakeRequest(signed, request.expiresAt + 1))
        assertEquals(
            "invalid_ttl",
            validateWakeRequest(request.copy(expiresAt = request.issuedAt + 30_001), request.issuedAt)
        )
        assertEquals(
            "future_issued_at",
            validateWakeRequest(request.copy(issuedAt = request.issuedAt + 60_000, expiresAt = request.issuedAt + 90_000), request.issuedAt)
        )
    }
}
