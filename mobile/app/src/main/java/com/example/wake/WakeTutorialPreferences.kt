package com.example.wake

import android.content.SharedPreferences

class WakeTutorialPreferences(
    private val preferences: SharedPreferences
) {
    fun isDismissed(pcId: String): Boolean = preferences.getBoolean(key(pcId), false)

    fun dismiss(pcId: String) {
        preferences.edit().putBoolean(key(pcId), true).apply()
    }

    fun showAgain(pcId: String) {
        preferences.edit().remove(key(pcId)).apply()
    }

    private fun key(pcId: String): String = "wake_tutorial_dismissed_${pcId.take(128)}"
}
