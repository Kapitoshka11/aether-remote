package com.example.data

import android.content.SharedPreferences
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet

internal class EphemeralSharedPreferences : SharedPreferences {
    private val values = ConcurrentHashMap<String, Any>()
    private val listeners = CopyOnWriteArraySet<SharedPreferences.OnSharedPreferenceChangeListener>()

    override fun getAll(): Map<String, *> = values.toMap()
    override fun getString(key: String, defValue: String?): String? = values[key] as? String ?: defValue
    override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = (values[key] as? Set<*>)?.filterIsInstance<String>()?.toSet() ?: defValues
    override fun getInt(key: String, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun contains(key: String): Boolean = values.containsKey(key)
    override fun edit(): SharedPreferences.Editor = Editor()
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) { listeners += listener }
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) { listeners -= listener }

    private inner class Editor : SharedPreferences.Editor {
        private val updates = linkedMapOf<String, Any?>()
        private var clear = false
        override fun putString(key: String, value: String?) = apply { updates[key] = value }
        override fun putStringSet(key: String, values: Set<String>?) = apply { updates[key] = values?.toSet() }
        override fun putInt(key: String, value: Int) = apply { updates[key] = value }
        override fun putLong(key: String, value: Long) = apply { updates[key] = value }
        override fun putFloat(key: String, value: Float) = apply { updates[key] = value }
        override fun putBoolean(key: String, value: Boolean) = apply { updates[key] = value }
        override fun remove(key: String) = apply { updates[key] = null }
        override fun clear() = apply { clear = true }
        override fun commit(): Boolean { applyChanges(); return true }
        override fun apply() = applyChanges()
        private fun applyChanges() {
            val changed = linkedSetOf<String>()
            synchronized(values) {
                if (clear) { changed += values.keys; values.clear() }
                updates.forEach { (key, value) ->
                    if (value == null) values.remove(key) else values[key] = value
                    changed += key
                }
            }
            changed.forEach { key -> listeners.forEach { it.onSharedPreferenceChanged(this@EphemeralSharedPreferences, key) } }
        }
    }
}
