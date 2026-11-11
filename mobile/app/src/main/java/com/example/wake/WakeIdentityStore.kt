package com.example.wake

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec

data class WakeIdentity(
    val deviceId: String,
    val publicKeySpki: ByteArray
) {
    override fun equals(other: Any?): Boolean = other is WakeIdentity &&
        deviceId == other.deviceId && publicKeySpki.contentEquals(other.publicKeySpki)

    override fun hashCode(): Int = 31 * deviceId.hashCode() + publicKeySpki.contentHashCode()
}

sealed interface WakeIdentityLoadResult {
    data class Ready(val identity: WakeIdentity) : WakeIdentityLoadResult
    data class Error(val code: String) : WakeIdentityLoadResult
}

interface WakeKeyProvider {
    fun publicKeyEncoded(): ByteArray
    fun sign(bytes: ByteArray): ByteArray
}

class AndroidWakeKeyProvider(
    private val alias: String = "aether_wake_identity_v1"
) : WakeKeyProvider {
    private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun ensureKey() {
        if (keyStore().containsAlias(alias)) return
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
            initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            generateKeyPair()
        }
    }

    override fun publicKeyEncoded(): ByteArray {
        ensureKey()
        return keyStore().getCertificate(alias).publicKey.encoded
    }

    override fun sign(bytes: ByteArray): ByteArray {
        ensureKey()
        val privateKey = keyStore().getKey(alias, null) as java.security.PrivateKey
        return Signature.getInstance("SHA256withECDSA").run {
            initSign(privateKey)
            update(bytes)
            sign()
        }
    }
}

class WakeIdentityStore(
    private val preferences: SharedPreferences,
    private val keyProvider: WakeKeyProvider = AndroidWakeKeyProvider(),
    private val randomBytes: (Int) -> ByteArray = { size -> ByteArray(size).also(SecureRandom()::nextBytes) }
) {
    fun loadOrCreate(): WakeIdentityLoadResult {
        val stored = preferences.getString(STORAGE_KEY, null)
        if (stored != null) {
            return runCatching {
                val json = JSONObject(stored)
                check(json.getInt("version") == 1)
                val deviceId = json.getString("deviceId")
                check(IDENTIFIER.matches(deviceId))
                val publicKey = Base64.decode(json.getString("publicKeySpki"), Base64.NO_WRAP)
                check(publicKey.contentEquals(keyProvider.publicKeyEncoded()))
                WakeIdentityLoadResult.Ready(WakeIdentity(deviceId, publicKey))
            }.getOrElse { WakeIdentityLoadResult.Error("identity_corrupt") }
        }

        val identity = WakeIdentity(
            deviceId = randomBytes(16).joinToString("") { "%02x".format(it.toInt() and 0xff) },
            publicKeySpki = keyProvider.publicKeyEncoded()
        )
        val json = JSONObject().apply {
            put("version", 1)
            put("deviceId", identity.deviceId)
            put("publicKeySpki", Base64.encodeToString(identity.publicKeySpki, Base64.NO_WRAP))
        }
        return if (preferences.edit().putString(STORAGE_KEY, json.toString()).commit()) {
            WakeIdentityLoadResult.Ready(identity)
        } else {
            WakeIdentityLoadResult.Error("storage_failed")
        }
    }

    fun sign(bytes: ByteArray): ByteArray = keyProvider.sign(bytes)

    fun sign(request: WakeRequest): WakeRequest = request.copy(
        signature = Base64.encodeToString(sign(canonicalizeWakeRequest(request)), Base64.NO_WRAP)
    )

    private companion object {
        const val STORAGE_KEY = "wake_identity_v1"
        val IDENTIFIER = Regex("^[0-9a-f]{32}$")
    }
}
