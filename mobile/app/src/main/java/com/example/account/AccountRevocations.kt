package com.example.account

import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

internal class AccountRevocations(private val preferences: SharedPreferences, ownerId: String) {
    private val key = "account_revocations_$ownerId"
    private fun read() = JSONObject(preferences.getString(key, null) ?: "{}")
    private fun ids(json: JSONObject, field: String): Set<String> {
        val array = json.optJSONArray(field) ?: return emptySet()
        return (0 until array.length()).map { array.getString(it) }.toSet()
    }
    private fun mutate(update: (JSONObject) -> Unit) = synchronized(lock) {
        val json = read()
        update(json)
        check(preferences.edit().putString(key, json.toString()).commit()) { "revocation_storage_failed" }
    }
    fun contains(id: String): Boolean = synchronized(lock) { id in ids(read(), "devices") }
    fun pending(): Set<String> = synchronized(lock) { ids(read(), "pending") }
    fun revoke(id: String) {
        require(Regex("^[0-9a-f]{64}$").matches(id))
        mutate { json ->
            json.put("devices", JSONArray((ids(json, "devices") + id).toList()))
            json.put("pending", JSONArray((ids(json, "pending") + id).toList()))
        }
    }
    fun merge(devices: List<AccountDevice>) = mutate { json ->
        json.put("devices", JSONArray((ids(json, "devices") + devices.filter { it.revoked }.map { it.id }).toList()))
    }
    fun acknowledge(id: String) = mutate { json -> json.put("pending", JSONArray((ids(json, "pending") - id).toList())) }
    companion object { private val lock = Any() }
}
