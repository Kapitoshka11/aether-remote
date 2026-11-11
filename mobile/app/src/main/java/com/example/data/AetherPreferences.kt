package com.example.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object AetherPreferences {
    data class Result(val preferences: SharedPreferences, val persistent: Boolean)
    @Volatile private var cached: Result? = null

    fun secure(context: Context): SharedPreferences = secureWithStatus(context).preferences

    fun secureWithStatus(context: Context): Result = cached ?: synchronized(this) {
        cached ?: create(context.applicationContext).also { cached = it }
    }

    private fun create(appContext: Context): Result = try {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        Result(EncryptedSharedPreferences.create(
            appContext,
            "aether_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        ), true)
    } catch (_: Exception) {
        Result(EphemeralSharedPreferences(), false)
    }
}
