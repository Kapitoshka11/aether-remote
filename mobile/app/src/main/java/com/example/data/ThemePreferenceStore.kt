package com.example.data

import android.content.SharedPreferences
import com.example.ui.theme.AetherThemeMode

class ThemePreferenceStore(private val preferences: SharedPreferences) {
    fun load(): AetherThemeMode {
        val storedValue = preferences.getString(KEY, null)
        if (storedValue == null) {
            save(INITIAL_THEME)
            return INITIAL_THEME
        }
        return AetherThemeMode.entries.singleOrNull { it.name == storedValue }
            ?: throw IllegalStateException("Unsupported persisted theme mode")
    }

    fun save(themeMode: AetherThemeMode) {
        preferences.edit().putString(KEY, themeMode.name).apply()
    }

    private companion object {
        const val KEY = "appearance_theme"
        val INITIAL_THEME = AetherThemeMode.DARK
    }
}
