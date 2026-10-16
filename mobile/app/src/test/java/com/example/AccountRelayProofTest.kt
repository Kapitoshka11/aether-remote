package com.example

import android.util.Base64
import com.example.account.AccountProtocol
import com.example.account.AccountRelayBridge
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AccountRelayProofTest {
    @Test
    fun relaySignatureBindsOwnerSessionRoleDeviceAndExpiry() {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val spki = Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)
        val device = AccountProtocol.deviceId(spki)
        val owner = UUID.randomUUID().toString()
        val session = UUID.randomUUID().toString()
        val nonce = "A".repeat(43)
        val now = 1_800_000_000_000L
        fun challenge() = JSONObject().put("ownerId", owner).put("sessionId", session).put("role", "phone")
            .put("deviceId", device).put("nonce", nonce).put("expiresAt", now + 15000)
        val proof = JSONObject(AccountRelayBridge.joinProof(challenge(), owner, session, device, pair.private, now))
        val canonical = "AETHER_RELAY_JOIN_V1\n$owner\n$session\nphone\n$device\n$nonce\n${now + 15000}"
        assertTrue(AccountProtocol.verify(canonical.toByteArray(), proof.getString("signature"), spki))
        for ((key, value) in listOf("ownerId" to UUID.randomUUID().toString(), "sessionId" to UUID.randomUUID().toString(),
            "role" to "host", "deviceId" to "b".repeat(64), "nonce" to "invalid")) {
            assertThrows(IllegalArgumentException::class.java) {
                AccountRelayBridge.joinProof(challenge().put(key, value), owner, session, device, pair.private, now)
            }
        }
        for (expiry in listOf<Any>(now, now + 30001, "1800000015000", now + 0.5)) {
            assertThrows(IllegalArgumentException::class.java) {
                AccountRelayBridge.joinProof(challenge().put("expiresAt", expiry), owner, session, device, pair.private, now)
            }
        }
    }
}
