package com.example

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReleaseUiTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun pairingAndAppearanceRemainUsableAfterRotation() {
        composeRule.onNodeWithText("Подключиться к ПК").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Настройки").performClick()
        composeRule.waitForIdle()
        capture("appearance-before")
        composeRule.onNodeWithText("Светлая").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        capture("appearance-light")
        composeRule.onNodeWithText("Тёмная").assertIsDisplayed().performClick()
        composeRule.activityRule.scenario.onActivity {
            it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        }
        composeRule.waitForIdle()
        composeRule.waitUntil(5_000) {
            composeRule.activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        }
        composeRule.onNodeWithText("Светлая").assertIsDisplayed()
        capture("appearance-landscape")
        composeRule.onNodeWithContentDescription("Закрыть").assertIsDisplayed().performClick()
        composeRule.onNodeWithText("Подключиться к ПК").assertIsDisplayed()
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.waitForIdleSync()
        android.os.SystemClock.sleep(300)
        val screenshot = instrumentation.uiAutomation.takeScreenshot()
        val output = File(instrumentation.targetContext.getExternalFilesDir(null), "$name.png")
        output.outputStream().use {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
            instrumentation.uiAutomation.executeShellCommand("cp ${output.absolutePath} /data/local/tmp/aether-$name.png")
        ).use { it.readBytes() }
        screenshot.recycle()
    }
}
