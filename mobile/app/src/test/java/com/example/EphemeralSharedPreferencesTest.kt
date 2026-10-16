package com.example

import com.example.data.EphemeralSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EphemeralSharedPreferencesTest {
    @Test
    fun behavesLikePreferencesWithoutWritingToDisk() {
        val preferences = EphemeralSharedPreferences()
        assertTrue(preferences.edit().putString("token", "secret").commit())
        assertEquals("secret", preferences.getString("token", null))
        preferences.edit().remove("token").apply()
        assertFalse(preferences.contains("token"))
    }
}
