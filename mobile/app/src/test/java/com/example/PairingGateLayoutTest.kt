package com.example

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import com.example.ui.screens.PairingGateScreen
import com.example.ui.screens.SavedComputerCard
import com.example.ui.screens.SavedPc
import com.example.account.AccountDevice
import com.example.ui.theme.AetherTheme
import com.example.ui.theme.AetherThemeMode
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w360dp-h640dp-xhdpi")
class PairingGateLayoutTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun compactPairingActionsRemainSingleLineAndBelowSettings() {
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK) {
                Box(Modifier.size(width = 360.dp, height = 640.dp)) {
                    PairingGateScreen(onConnect = { _, _, _, _, _ -> })
                }
            }
        }

        val settings = composeRule.onNodeWithContentDescription("Настройки")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        val heading = composeRule.onNodeWithText("Установить связь")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        assertTrue(settings.bottom <= heading.top)

        listOf("Сеть", "QR-код", "IP/порт").forEach { label ->
            val bounds = composeRule.onNodeWithText(label, useUnmergedTree = true)
                .assertIsDisplayed()
                .getUnclippedBoundsInRoot()
            assertTrue("$label must remain on one line: $bounds", bounds.bottom - bounds.top <= 24.dp)
        }
    }

    @Test
    fun twelveDigitCodeCanBeEnteredOnCompactPhone() {
        var submitted = ""
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK) {
                Box(Modifier.size(width = 360.dp, height = 640.dp)) {
                    PairingGateScreen(onConnect = { _, _, pin, _, _ -> submitted = pin })
                }
            }
        }
        val inputs = composeRule.onAllNodes(hasSetTextAction())
        inputs.assertCountEquals(12)
        "001042654321".forEachIndexed { index, digit ->
            inputs[index].assertIsDisplayed().performTextInput(digit.toString())
        }
        composeRule.onNodeWithText("Подключиться к ПК").performClick()
        org.junit.Assert.assertEquals("001042654321", submitted)
    }

    @Test
    @Config(sdk = [36], qualifiers = "w640dp-h360dp-land-xhdpi")
    fun lowLandscapeViewportKeepsPrimaryActionVisible() {
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK) {
                Box(Modifier.size(width = 640.dp, height = 360.dp)) {
                    PairingGateScreen(onConnect = { _, _, _, _, _ -> })
                }
            }
        }

        composeRule.onNodeWithText("Установить связь").assertIsDisplayed()
        composeRule.onNodeWithText("Сеть").assertIsDisplayed()
        composeRule.onNodeWithText("QR-код").assertIsDisplayed()
        composeRule.onNodeWithText("IP/порт").assertIsDisplayed()
        composeRule.onNodeWithText("Подключиться к ПК").assertIsDisplayed()
    }

    @Test
    fun savedComputerCardKeepsAddressOnOneLineAndActionsInsideWidth() {
        val pc = SavedPc(
            id = "local",
            hostName = "Очень длинное имя домашнего компьютера",
            hostIp = "192.168.31.192",
            hostPort = 8080,
            lastConnected = 1L
        )
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK) {
                SavedComputerCard(pc, {}, {}, {}, {}, modifier = Modifier.width(320.dp))
            }
        }

        val address = composeRule.onNodeWithText("192.168.31.192:8080")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        assertTrue("address must remain on one line: $address", address.bottom - address.top <= 24.dp)
        assertTrue("address must not collapse horizontally: $address", address.right - address.left >= 90.dp)
        listOf("Включить компьютер", "Инструкция Wake-on-LAN", "Удалить компьютер").forEach { description ->
            val bounds = composeRule.onNodeWithContentDescription(description).assertIsDisplayed().getUnclippedBoundsInRoot()
            assertTrue("$description exceeds card width: $bounds", bounds.left >= 0.dp && bounds.right <= 320.dp)
        }
    }

    @Test
    fun accountComputerAppearsInPairingListAndConnects() {
        val host = AccountDevice(
            id = "a".repeat(64),
            ownerId = "owner",
            kind = "host",
            name = "Домашний ПК",
            publicKeySpki = "key",
            tlsFingerprint = "b".repeat(64),
            lanIp = "192.168.1.20",
            port = 8080,
            lastSeenAt = "now",
            revoked = false
        )
        var selected: AccountDevice? = null
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK) {
                Box(Modifier.size(width = 360.dp, height = 640.dp)) {
                    PairingGateScreen(
                        onConnect = { _, _, _, _, _ -> },
                        accountHosts = listOf(host),
                        onConnectAccountHost = { selected = it }
                    )
                }
            }
        }

        composeRule.onNodeWithText("Компьютеры (1)").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Домашний ПК").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Открыть", useUnmergedTree = true).performScrollTo().performClick()
        org.junit.Assert.assertEquals(host, selected)
    }
}
