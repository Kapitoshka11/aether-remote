package com.example

import android.util.Base64
import com.example.account.AccountChallenge
import com.example.account.AccountGrant
import com.example.account.AccountProtocol
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

@RunWith(RobolectricTestRunner::class)
class AccountProtocolTest {
    private val fixture = JSONObject(requireNotNull(javaClass.classLoader?.getResourceAsStream("account-protocol-v1.json"))
        .bufferedReader().use { it.readText() })
    private val grant = AccountGrant.fromJson(fixture.getJSONObject("grant"))
    private val proof = fixture.getJSONObject("proof")
    private val challenge = AccountChallenge.fromJson(proof)

    @Test
    fun nodeSignaturesAndCanonicalBytesMatchAndroid() {
        assertEquals(fixture.getString("canonicalGrant"), AccountProtocol.canonicalGrant(grant).toString(Charsets.UTF_8))
        assertEquals(fixture.getString("canonicalProof"), AccountProtocol.canonicalProof(challenge).toString(Charsets.UTF_8))
        assertTrue(AccountProtocol.verifyGrant(grant, fixture.getString("hostPublicKeySpki")))
        assertTrue(AccountProtocol.verify(AccountProtocol.canonicalProof(challenge), proof.getString("signature"), grant.phonePublicKeySpki))
    }

    @Test
    fun alteredIdentitiesAndPermissionsInvalidateGrant() {
        val host = fixture.getString("hostPublicKeySpki")
        assertFalse(AccountProtocol.verifyGrant(grant.copy(phoneId = "b".repeat(64)), host))
        assertFalse(AccountProtocol.verifyGrant(grant.copy(hostTlsFingerprint = "b".repeat(64)), host))
        assertFalse(AccountProtocol.verifyGrant(grant.copy(permissions = "admin"), host))
        assertFalse(AccountProtocol.verifyGrant(grant.copy(revision = 0), host))
        assertFalse(AccountProtocol.verifyGrant(grant.copy(signature = grant.signature + "="), host))
        assertFalse(AccountProtocol.verifyGrant(grant, grant.phonePublicKeySpki))
    }

    @Test
    fun changingTransportOrNonceInvalidatesProof() {
        assertFalse(AccountProtocol.verify(AccountProtocol.canonicalProof(challenge.copy(transport = "relay")),
            proof.getString("signature"), grant.phonePublicKeySpki))
        assertFalse(AccountProtocol.verify(AccountProtocol.canonicalProof(challenge.copy(nonce = "A".repeat(43))),
            proof.getString("signature"), grant.phonePublicKeySpki))
    }

    @Test
    fun androidCanSignAndVerifyP256Der() {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val spki = Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)
        val local = challenge.copy(phoneId = AccountProtocol.deviceId(spki))
        val signed = AccountProtocol.signProof(local, pair.private)
        assertTrue(AccountProtocol.verify(AccountProtocol.canonicalProof(local), signed.getString("signature"), spki))
    }

    @Test
    fun signedFieldsRejectJsonCoercion() {
        for (value in listOf<Any>(1.5, "1", true, 4_294_967_297L)) {
            assertThrows(IllegalArgumentException::class.java) {
                AccountGrant.fromJson(grant.toJson().put("revision", value))
            }
        }
        for (value in listOf<Any>(1.5, "123", true, Long.MAX_VALUE)) {
            assertThrows(IllegalArgumentException::class.java) {
                AccountChallenge.fromJson(challenge.toJson().put("expiresAt", value))
            }
        }
        assertThrows(IllegalArgumentException::class.java) {
            AccountGrant.fromJson(grant.toJson().put("permissions", 123))
        }
    }

    @Test
    fun malformedKeysAndChallengeFieldsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) { AccountProtocol.publicKey(grant.phonePublicKeySpki + "\n") }
        assertThrows(IllegalArgumentException::class.java) { AccountProtocol.canonicalProof(challenge.copy(sessionId = "bad\nvalue")) }
        assertThrows(IllegalArgumentException::class.java) { AccountProtocol.canonicalProof(challenge.copy(expiresAt = Long.MAX_VALUE)) }
        assertThrows(IllegalArgumentException::class.java) { AccountProtocol.canonicalProof(challenge.copy(transport = "guest")) }
    }
}
