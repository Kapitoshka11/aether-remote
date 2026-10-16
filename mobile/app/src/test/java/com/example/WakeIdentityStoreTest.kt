package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.wake.WakeIdentityLoadResult
import com.example.wake.WakeIdentityStore
import com.example.wake.WakeKeyProvider
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature

@RunWith(RobolectricTestRunner::class)
class WakeIdentityStoreTest {
    private class TestKeyProvider : WakeKeyProvider {
        private val pair: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()

        override fun publicKeyEncoded(): ByteArray = pair.public.encoded

        override fun sign(bytes: ByteArray): ByteArray = Signature.getInstance("SHA256withECDSA").run {
            initSign(pair.private)
            update(bytes)
            sign()
        }
    }

    @Test
    fun identityPersistsAndCorruptionDoesNotReplaceIt() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = context.getSharedPreferences("wake_identity_test", Context.MODE_PRIVATE).apply { edit().clear().commit() }
        val keyProvider = TestKeyProvider()
        val store = WakeIdentityStore(prefs, keyProvider) { ByteArray(16) { it.toByte() } }

        val created = store.loadOrCreate() as WakeIdentityLoadResult.Ready
        assertEquals("000102030405060708090a0b0c0d0e0f", created.identity.deviceId)
        assertArrayEquals(keyProvider.publicKeyEncoded(), created.identity.publicKeySpki)
        assertEquals(created, store.loadOrCreate())
        assertTrue(store.sign("wake".toByteArray()).isNotEmpty())

        prefs.edit().putString("wake_identity_v1", "corrupt").commit()
        assertEquals(WakeIdentityLoadResult.Error("identity_corrupt"), store.loadOrCreate())
        assertEquals("corrupt", prefs.getString("wake_identity_v1", null))
    }
}
