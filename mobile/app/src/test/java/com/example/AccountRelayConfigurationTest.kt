package com.example

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountRelayConfigurationTest {
    @Test
    fun accountBuildConfigDefaultsToEmptyAndValidatesConfiguredRelayUrl() {
        val rawRelay = BuildConfig.ACCOUNT_RELAY_URL
        if (rawRelay.isNotBlank()) {
            val relayUrl = URI(rawRelay)
            assertEquals("wss", relayUrl.scheme)
            assertTrue(!relayUrl.host.isNullOrBlank())
            assertNull(relayUrl.userInfo)
            assertNull(relayUrl.query)
            assertNull(relayUrl.fragment)
        }
        val rawSupabase = BuildConfig.SUPABASE_URL
        if (rawSupabase.isNotBlank()) {
            val supabaseUrl = URI(rawSupabase)
            assertEquals("https", supabaseUrl.scheme)
            assertNull(supabaseUrl.userInfo)
        }
        assertTrue(!BuildConfig.SUPABASE_PUBLISHABLE_KEY.contains("service_role"))
    }
}
