package com.example

import com.example.account.AccountDevice
import com.example.account.accountEndpointCandidates
import org.junit.Assert.assertEquals
import org.junit.Test

class AccountEndpointSelectionTest {
    @Test
    fun includesLanAndVpnCandidatesWithoutUnsafeOrDuplicateAddresses() {
        val host = AccountDevice(
            id = "a".repeat(64),
            ownerId = "11111111-1111-4111-8111-111111111111",
            kind = "host",
            name = "VPN host",
            publicKeySpki = "key",
            tlsFingerprint = "b".repeat(64),
            lanIp = "192.168.1.20",
            port = 8080,
            lastSeenAt = "2026-10-14T00:00:00Z",
            revoked = false,
            networkEndpoints = listOf("192.168.1.20", "100.84.2.10", "172.19.0.1", "127.0.0.1", "100.84.2.10")
        )

        assertEquals(
            listOf("192.168.1.20", "100.84.2.10", "172.19.0.1"),
            accountEndpointCandidates(host)
        )
    }

    @Test
    fun fallsBackToLegacyLanAddressWhenCloudRowHasNoCandidateList() {
        val host = AccountDevice(
            id = "a".repeat(64),
            ownerId = "11111111-1111-4111-8111-111111111111",
            kind = "host",
            name = "Legacy host",
            publicKeySpki = "key",
            tlsFingerprint = "b".repeat(64),
            lanIp = "10.0.0.8",
            port = 8080,
            lastSeenAt = "2026-10-14T00:00:00Z",
            revoked = false
        )

        assertEquals(listOf("10.0.0.8"), accountEndpointCandidates(host))
    }
}
