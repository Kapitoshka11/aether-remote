package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.account.AccountRevocations
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AccountRevocationsTest {
    @Test
    fun pendingDenialSurvivesReloadAndStaleCloudState() {
        val prefs = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences(UUID.randomUUID().toString(), 0)
        val owner = UUID.randomUUID().toString()
        val id = "a".repeat(64)
        val first = AccountRevocations(prefs, owner)
        first.revoke(id)
        val restored = AccountRevocations(prefs, owner)
        assertTrue(restored.contains(id))
        assertEquals(setOf(id), restored.pending())
        restored.merge(emptyList())
        assertTrue(restored.contains(id))
        restored.acknowledge(id)
        assertTrue(restored.pending().isEmpty())
        assertTrue(restored.contains(id))
        assertFalse(AccountRevocations(prefs, UUID.randomUUID().toString()).contains(id))
        val second = "b".repeat(64)
        first.revoke(second)
        assertTrue(restored.contains(second))
        assertTrue(restored.contains(id))
    }
}
