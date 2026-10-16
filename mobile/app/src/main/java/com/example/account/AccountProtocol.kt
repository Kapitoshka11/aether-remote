package com.example.account

import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec

internal fun JSONObject.accountString(name: String): String = get(name).let {
    require(it is String) { "invalid_account_field" }
    it
}

internal fun JSONObject.accountLong(name: String): Long = get(name).let {
    require(it is Int || it is Long) { "invalid_account_number" }
    (it as Number).toLong().also { value -> require(value in 0..9_007_199_254_740_991L) }
}

internal fun JSONObject.accountInt(name: String): Int = accountLong(name).let {
    require(it <= Int.MAX_VALUE)
    it.toInt()
}

data class AccountGrant(
    val ownerId: String,
    val hostId: String,
    val phoneId: String,
    val phonePublicKeySpki: String,
    val hostTlsFingerprint: String,
    val issuedAt: Long,
    val grantId: String,
    val revision: Int,
    val signature: String,
    val version: Int = 1,
    val permissions: String = "control"
) {
    fun toJson() = JSONObject().put("version", version).put("ownerId", ownerId).put("hostId", hostId)
        .put("phoneId", phoneId).put("phonePublicKeySpki", phonePublicKeySpki)
        .put("hostTlsFingerprint", hostTlsFingerprint).put("issuedAt", issuedAt)
        .put("grantId", grantId).put("revision", revision).put("signature", signature).put("permissions", permissions)

    companion object {
        fun fromJson(json: JSONObject) = AccountGrant(
            json.accountString("ownerId"), json.accountString("hostId"), json.accountString("phoneId"),
            json.accountString("phonePublicKeySpki"), json.accountString("hostTlsFingerprint"),
            json.accountLong("issuedAt"), json.accountString("grantId"), json.accountInt("revision"),
            json.accountString("signature"), json.accountInt("version"), json.accountString("permissions")
        )
    }
}

data class AccountChallenge(
    val ownerId: String,
    val hostId: String,
    val phoneId: String,
    val sessionId: String,
    val transport: String,
    val grantId: String,
    val nonce: String,
    val expiresAt: Long,
    val version: Int = 1
) {
    fun toJson() = JSONObject().put("version", version).put("ownerId", ownerId)
        .put("hostId", hostId).put("phoneId", phoneId).put("sessionId", sessionId)
        .put("transport", transport).put("grantId", grantId).put("nonce", nonce).put("expiresAt", expiresAt)

    companion object {
        fun fromJson(json: JSONObject) = AccountChallenge(
            json.accountString("ownerId"), json.accountString("hostId"), json.accountString("phoneId"),
            json.accountString("sessionId"), json.accountString("transport"), json.accountString("grantId"),
            json.accountString("nonce"), json.accountLong("expiresAt"), json.accountInt("version")
        )
    }
}

object AccountProtocol {
    private val hex = Regex("^[0-9a-f]{64}$")
    private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private const val URL_FLAGS = Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

    fun base64Url(bytes: ByteArray): String = Base64.encodeToString(bytes, URL_FLAGS)

    fun publicKey(spki: String): PublicKey {
        require(Regex("^[A-Za-z0-9+/]{122}==$").matches(spki)) { "invalid_device_key" }
        val bytes = Base64.decode(spki, Base64.NO_WRAP)
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(bytes)) as ECPublicKey
        val expected = java.security.AlgorithmParameters.getInstance("EC").apply {
            init(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(java.security.spec.ECParameterSpec::class.java)
        require(key.params.curve == expected.curve && key.params.generator == expected.generator &&
            key.params.order == expected.order && key.params.cofactor == expected.cofactor &&
            Base64.encodeToString(key.encoded, Base64.NO_WRAP) == spki) { "invalid_device_key" }
        return key
    }

    fun deviceId(spki: String): String = MessageDigest.getInstance("SHA-256")
        .digest(publicKey(spki).encoded).joinToString("") { "%02x".format(it) }

    fun canonicalGrant(grant: AccountGrant): ByteArray {
        require(grant.version == 1 && uuid.matches(grant.ownerId) && uuid.matches(grant.grantId) &&
            hex.matches(grant.hostId) && hex.matches(grant.phoneId) && grant.hostId != grant.phoneId &&
            hex.matches(grant.hostTlsFingerprint) && grant.issuedAt in 1..MAX_SAFE_INTEGER &&
            grant.revision > 0 && grant.permissions == "control" &&
            deviceId(grant.phonePublicKeySpki) == grant.phoneId) { "invalid_grant" }
        return listOf("AETHER_ACCOUNT_GRANT_V1", grant.ownerId, grant.hostId, grant.phoneId,
            grant.phonePublicKeySpki, grant.hostTlsFingerprint, grant.permissions, grant.issuedAt,
            grant.grantId, grant.revision).joinToString("\n").toByteArray(Charsets.UTF_8)
    }

    fun verifyGrant(grant: AccountGrant, hostSpki: String): Boolean = runCatching {
        deviceId(hostSpki) == grant.hostId && verify(canonicalGrant(grant), grant.signature, hostSpki)
    }.getOrDefault(false)

    fun canonicalProof(challenge: AccountChallenge): ByteArray {
        require(challenge.version == 1 && uuid.matches(challenge.ownerId) && uuid.matches(challenge.grantId) &&
            uuid.matches(challenge.sessionId) && hex.matches(challenge.hostId) && hex.matches(challenge.phoneId) &&
            Regex("^[A-Za-z0-9_-]{43}$").matches(challenge.nonce) &&
            base64Url(Base64.decode(challenge.nonce, URL_FLAGS)) == challenge.nonce &&
            challenge.transport in setOf("lan", "relay") && challenge.expiresAt in 1..MAX_SAFE_INTEGER) {
            "invalid_challenge"
        }
        return listOf("AETHER_ACCOUNT_AUTH_V1", challenge.ownerId, challenge.hostId, challenge.phoneId,
            challenge.sessionId, challenge.transport, challenge.grantId, challenge.nonce,
            challenge.expiresAt).joinToString("\n").toByteArray(Charsets.UTF_8)
    }

    // Call only after comparing every identity field with the selected, verified local grant.
    fun signProof(challenge: AccountChallenge, privateKey: PrivateKey): JSONObject = challenge.toJson()
        .put("signature", base64Url(Signature.getInstance("SHA256withECDSA").run {
            initSign(privateKey)
            update(canonicalProof(challenge))
            sign()
        }))

    fun verify(bytes: ByteArray, signature: String, spki: String): Boolean = runCatching {
        require(Regex("^[A-Za-z0-9_-]{90,100}$").matches(signature))
        val decoded = Base64.decode(signature, URL_FLAGS)
        require(base64Url(decoded) == signature)
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey(spki))
            update(bytes)
            verify(decoded)
        }
    }.getOrDefault(false)
}
