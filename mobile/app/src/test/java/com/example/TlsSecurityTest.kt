package com.example

import com.example.network.TlsPinStore
import com.example.network.guestSessionTokenPreferenceKey
import com.example.network.normalizeTlsFingerprint
import com.example.network.requireMatchingTlsFingerprint
import java.security.cert.CertificateException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class TlsSecurityTest {
    private val fingerprint = "SHA256:${"AB".repeat(32)}"

    @Test
    fun firstConnectionRequiresOutOfBandFingerprint() {
        assertThrows(CertificateException::class.java) {
            requireMatchingTlsFingerprint(null, fingerprint)
        }
    }

    @Test
    fun fingerprintsAreNormalizedAndMalformedValuesRejected() {
        assertEquals(fingerprint, normalizeTlsFingerprint("sha256:${"ab".repeat(32)}"))
        assertEquals(fingerprint, normalizeTlsFingerprint("ab".repeat(32)))
        assertNull(normalizeTlsFingerprint("SHA256:1234"))
    }

    @Test
    fun changedHostCertificateIsRejected() {
        requireMatchingTlsFingerprint(fingerprint, fingerprint)
        assertThrows(CertificateException::class.java) {
            requireMatchingTlsFingerprint(fingerprint, "SHA256:${"CD".repeat(32)}")
        }
    }

    @Test
    fun malformedExpectedFingerprintMustNotDisablePinning() {
        assertThrows(CertificateException::class.java) {
            requireMatchingTlsFingerprint("SHA256:invalid", fingerprint)
        }
    }

    @Test
    fun pinsPersistPerEndpoint() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        val store = TlsPinStore(context)
        store.remove("192.168.1.42", 8080)
        store.save("192.168.1.42", 8080, fingerprint.lowercase())
        assertEquals(fingerprint, store.get("192.168.1.42", 8080))
        assertNull(store.get("192.168.1.42", 8081))
    }

    @Test
    fun guestSessionTokensAreBoundToEndpointAndTlsIdentity() {
        val otherFingerprint = "SHA256:${"CD".repeat(32)}"
        val key = guestSessionTokenPreferenceKey("PC.LOCAL.", 8080, fingerprint.lowercase())

        assertEquals(key, guestSessionTokenPreferenceKey("pc.local", 8080, fingerprint))
        assertTrue(key.startsWith("guest_token_v2_"))
        assertTrue(key != guestSessionTokenPreferenceKey("pc.local", 8081, fingerprint))
        assertTrue(key != guestSessionTokenPreferenceKey("pc.local", 8080, otherFingerprint))
    }
}
