package com.example

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AccountRelayConfigurationTest {
    @Test
    fun productionRelayDefaultIsSecureAndContainsNoCredentials() {
        val relayUrl = URI(BuildConfig.ACCOUNT_RELAY_URL)

        assertEquals("wss", relayUrl.scheme)
        assertEquals("aether-account-relay.akulenoklaha.workers.dev", relayUrl.host)
        assertNull(relayUrl.userInfo)
        assertNull(relayUrl.query)
        assertNull(relayUrl.fragment)
    }
}
