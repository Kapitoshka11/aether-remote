package com.example

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.example.account.AccountDevice
import com.example.account.AccountProfile
import com.example.account.AccountState
import com.example.ui.screens.AccountPanelContent
import com.example.ui.theme.AetherTheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w360dp-h640dp-xhdpi")
class AccountScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun emailSignInFitsInsideSettingsOnSmallScreen() {
        var submitted: List<String>? = null
        compose.setContent { AetherTheme(themeMode = com.example.ui.theme.AetherThemeMode.DARK) {
            Box(Modifier.size(360.dp, 640.dp)) {
                AccountPanelContent(AccountState(), {}) { action, email, password -> submitted = listOf(action, email, password) }
            }
        } }
        compose.onNodeWithText("Продолжить в гостевом режиме").assertDoesNotExist()
        compose.onNodeWithText("Войти через Google").assertDoesNotExist()
        compose.onNodeWithText("Почта").performTextInput("test@example.test")
        compose.onNodeWithText("Пароль").performTextInput("password123")
        compose.onNodeWithText("Войти", useUnmergedTree = true).performClick()
        assertEquals(listOf("sign-in", "test@example.test", "password123"), submitted)
        compose.onNodeWithText("Пароль").assert(SemanticsMatcher.expectValue(
            androidx.compose.ui.semantics.SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString("")))
    }

    @Test
    fun internetStatusFitsAConstrainedBadgeWithALongHostName() {
        compose.setContent { AetherTheme(themeMode = com.example.ui.theme.AetherThemeMode.DARK) {
            com.example.ui.components.StatusBadge(com.example.model.ConnectionStatus.CONNECTED,
                "Очень длинное название домашнего компьютера", Modifier.size(240.dp, 48.dp), transport = "relay")
        } }
        val node = compose.onNodeWithText("ЧЕРЕЗ ИНТЕРНЕТ", substring = true).assertIsDisplayed().fetchSemanticsNode()
        val density = compose.density.density
        assertTrue(node.boundsInRoot.width <= 240 * density)
        assertTrue(node.boundsInRoot.height <= 48 * density)
    }

    @Test
    @Config(sdk = [36], qualifiers = "w640dp-h360dp-land-xhdpi")
    fun revokedHostCannotConnectAndLogoutRemainsReachableInLandscape() {
        var connected = false
        var logout = false
        val host = AccountDevice("a".repeat(64), "owner", "host", "Домашний ПК", "key", "pin", null, 8080, "", true)
        compose.setContent { AetherTheme(themeMode = com.example.ui.theme.AetherThemeMode.DARK) {
            Box(Modifier.size(640.dp, 360.dp)) {
                AccountPanelContent(AccountState(profile = AccountProfile("owner", "test@example.test"), devices = listOf(host)),
                    { connected = true }) { action, _, _ -> logout = action == "sign-out" }
            }
        } }
        compose.onNodeWithText("Доступ отозван").assertIsDisplayed()
        compose.onNodeWithText("Подключиться").assertDoesNotExist()
        assertFalse(connected)
        compose.onNodeWithText("Выйти").performClick()
        assertTrue(logout)
    }
}
