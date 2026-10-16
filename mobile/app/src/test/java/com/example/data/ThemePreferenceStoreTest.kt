package com.example.data

import com.example.ui.theme.AetherThemeMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemePreferenceStoreTest {
    @Test
    fun `first launch explicitly initializes dark theme and persists light choice`() {
        val preferences = EphemeralSharedPreferences()
        val store = ThemePreferenceStore(preferences)

        assertEquals(AetherThemeMode.DARK, store.load())
        assertTrue(preferences.contains("appearance_theme"))
        assertEquals(AetherThemeMode.DARK.name, preferences.getString("appearance_theme", null))
        store.save(AetherThemeMode.LIGHT)
        assertEquals(AetherThemeMode.LIGHT, store.load())
    }

    @Test
    fun `unknown persisted theme is rejected instead of silently using dark`() {
        val preferences = EphemeralSharedPreferences()
        preferences.edit().putString("appearance_theme", "SYSTEM").apply()

        assertThrows(IllegalStateException::class.java) {
            ThemePreferenceStore(preferences).load()
        }
    }
}
