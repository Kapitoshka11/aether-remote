package com.example.wake

import android.content.SharedPreferences
import com.example.network.isLoopbackHostname
import org.json.JSONObject

data class WakeEnrollment(
    val groupId: String,
    val targetDeviceId: String,
    val relayUrl: String,
    val certificateJson: String,
    val ownerPublicKeySpki: String
)

class WakeEnrollmentStore(private val preferences: SharedPreferences) {
    fun save(enrollment: WakeEnrollment) {
        require(ID.matches(enrollment.groupId) && ID.matches(enrollment.targetDeviceId))
        require(isAllowedWakeRelayUrl(enrollment.relayUrl))
        JSONObject(enrollment.certificateJson)
        val json = JSONObject().apply {
            put("version", 1)
            put("groupId", enrollment.groupId)
            put("targetDeviceId", enrollment.targetDeviceId)
            put("relayUrl", enrollment.relayUrl)
            put("certificateJson", enrollment.certificateJson)
            put("ownerPublicKeySpki", enrollment.ownerPublicKeySpki)
        }
        preferences.edit().putString(key(enrollment.targetDeviceId), json.toString()).apply()
    }

    fun get(targetDeviceId: String): WakeEnrollment? = runCatching {
        val json = JSONObject(preferences.getString(key(targetDeviceId), null) ?: return null)
        check(json.getInt("version") == 1)
        val result = WakeEnrollment(
            groupId = json.getString("groupId"),
            targetDeviceId = json.getString("targetDeviceId"),
            relayUrl = json.getString("relayUrl"),
            certificateJson = json.getString("certificateJson"),
            ownerPublicKeySpki = json.getString("ownerPublicKeySpki")
        )
        check(result.targetDeviceId == targetDeviceId && ID.matches(result.groupId) && ID.matches(result.targetDeviceId))
        check(isAllowedWakeRelayUrl(result.relayUrl))
        JSONObject(result.certificateJson)
        result
    }.getOrNull()

    private fun key(targetDeviceId: String) = "wake_enrollment_$targetDeviceId"

    private companion object { val ID = Regex("^[0-9a-f]{32}$") }
}

internal fun isAllowedWakeRelayUrl(value: String): Boolean = runCatching {
    val relay = java.net.URI(value)
    val host = relay.host?.lowercase().orEmpty()
    val scheme = relay.scheme?.lowercase()
    host.isNotBlank() && relay.userInfo == null && relay.query == null && relay.fragment == null &&
        (relay.port == -1 || relay.port in 1..65535) &&
        (scheme == "https" || (scheme == "http" && isLoopbackHostname(host)))
}.getOrDefault(false)
