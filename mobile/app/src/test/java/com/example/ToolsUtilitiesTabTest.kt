package com.example

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.runtime.Composable
import com.example.model.ClipboardData
import com.example.data.ClipboardHistoryItem
import com.example.ui.screens.ToolsUtilitiesTab
import com.example.ui.theme.AetherTheme
import com.example.ui.theme.AetherThemeMode
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ToolsUtilitiesTabTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun setThemedContent(content: @Composable () -> Unit) {
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK, content = content)
        }
    }

    @Test
    fun `disconnect button at bottom invokes disconnect action`() {
        var disconnected = false
        setThemedContent {
            ToolsUtilitiesTab(
                clipboardData = ClipboardData(),
                onReadPcClipboard = {},
                onSendToPcClipboard = {},
                onDisconnect = { disconnected = true }
            )
        }

        composeRule.onNodeWithText("Отключиться от ПК").assertExists().performScrollTo().performClick()
        assertTrue(disconnected)
    }

    @Test
    fun `clipboard history is shown as separate text cards`() {
        setThemedContent {
            ToolsUtilitiesTab(
                clipboardData = ClipboardData(),
                clipboardHistory = listOf(
                    ClipboardHistoryItem(id = 2, text = "Второй текст", source = "pc"),
                    ClipboardHistoryItem(id = 1, text = "Первый текст", source = "phone")
                ),
                onReadPcClipboard = {},
                onSendToPcClipboard = {},
                onDisconnect = {}
            )
        }

        composeRule.onNodeWithText("История буфера · 2/10").assertExists().performScrollTo()
        composeRule.onNodeWithText("Второй текст").assertExists()
        composeRule.onNodeWithText("Первый текст").assertExists()
        composeRule.onNodeWithText("С компьютера").assertExists()
        composeRule.onNodeWithText("С телефона").assertExists()
    }
}
