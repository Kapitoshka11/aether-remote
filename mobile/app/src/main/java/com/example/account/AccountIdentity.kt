package com.example.account

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec

class AccountIdentity private constructor(val publicKeySpki: String, val privateKey: PrivateKey) {
    val id: String = AccountProtocol.deviceId(publicKeySpki)

    companion object {
        private const val ALIAS = "aether_account_device_v1"

        // Keystore access belongs on Dispatchers.IO, never in a composable.
        @Synchronized
        fun loadOrCreate(): AccountIdentity {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (!store.containsAlias(ALIAS)) {
                KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore").apply {
                    initialize(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                        .setDigests(KeyProperties.DIGEST_SHA256).build())
                }.generateKeyPair()
            }
            return AccountIdentity(
                Base64.encodeToString(store.getCertificate(ALIAS).publicKey.encoded, Base64.NO_WRAP),
                store.getKey(ALIAS, null) as PrivateKey
            )
        }
    }
}
