package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.wake.WakeTutorialPreferences
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WakeTutorialPreferencesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun clear() {
        context.getSharedPreferences("wake_tutorial_test", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun dismissalIsRememberedPerPc() {
        val preferences = WakeTutorialPreferences(context.getSharedPreferences("wake_tutorial_test", Context.MODE_PRIVATE))
        assertFalse(preferences.isDismissed("pc-a"))
        preferences.dismiss("pc-a")
        assertTrue(preferences.isDismissed("pc-a"))
        assertFalse(preferences.isDismissed("pc-b"))
        preferences.showAgain("pc-a")
        assertFalse(preferences.isDismissed("pc-a"))
    }
}
