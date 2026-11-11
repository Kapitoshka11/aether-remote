package com.example

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasProgressBarRangeInfo
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.click
import androidx.compose.ui.test.down
import androidx.compose.ui.test.cancel
import androidx.compose.ui.test.moveTo
import androidx.compose.ui.test.up
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.unit.dp
import com.example.aetherdeck.AetherDeck
import com.example.aetherdeck.DeckControl
import com.example.aetherdeck.DeckPage
import com.example.aetherdeck.DeckUiState
import com.example.ui.components.AetherDeckControl
import com.example.ui.screens.AetherDeckOrientationPrompt
import com.example.ui.screens.AetherDeckTab
import com.example.ui.theme.AetherTheme
import com.example.ui.theme.AetherThemeMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.math.abs

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AetherDeckComposeTest {
    @get:Rule
    val composeRule = createComposeRule()

    private fun setThemedContent(content: @Composable () -> Unit) {
        composeRule.setContent {
            AetherTheme(themeMode = AetherThemeMode.DARK, content = content)
        }
    }

    @Test
    fun orientationPromptRendersBothActionsAtPortraitWidth() {
        setThemedContent {
            AetherDeckOrientationPrompt(onLandscape = {}, onStay = {})
        }

        composeRule.onNodeWithText("Остаться").assertIsDisplayed()
        composeRule.onNodeWithText("Перейти в альбомный режим").assertIsDisplayed()
    }

    @Test
    fun orientationPromptStayActionInvokesOnlyStayCallback() {
        var stayCalls = 0
        var landscapeCalls = 0
        setThemedContent {
            AetherDeckOrientationPrompt(
                onLandscape = { landscapeCalls += 1 },
                onStay = { stayCalls += 1 }
            )
        }

        composeRule.onNodeWithText("Остаться").performClick()

        composeRule.runOnIdle {
            assertEquals(1, stayCalls)
            assertEquals(0, landscapeCalls)
        }
    }

    @Test
    fun orientationPromptLandscapeActionInvokesOnlyLandscapeCallback() {
        var stayCalls = 0
        var landscapeCalls = 0
        setThemedContent {
            AetherDeckOrientationPrompt(
                onLandscape = { landscapeCalls += 1 },
                onStay = { stayCalls += 1 }
            )
        }

        composeRule.onNodeWithText("Перейти в альбомный режим").performClick()

        composeRule.runOnIdle {
            assertEquals(0, stayCalls)
            assertEquals(1, landscapeCalls)
        }
    }

    @Test
    fun orientationPromptActionsUseStackedFullWidthLayout() {
        setThemedContent {
            AetherDeckOrientationPrompt(onLandscape = {}, onStay = {})
        }

        val stayBounds = composeRule.onNodeWithTag("deck-orientation-stay")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        val landscapeBounds = composeRule.onNodeWithTag("deck-orientation-landscape")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()

        assertTrue(stayBounds.right - stayBounds.left >= 200.dp)
        assertEquals(stayBounds.left.value, landscapeBounds.left.value, 0.5f)
        assertEquals(stayBounds.right.value, landscapeBounds.right.value, 0.5f)
        assertTrue(landscapeBounds.top > stayBounds.bottom)
    }

    @Test
    fun missingTargetFolderIgnoresTouchInput() {
        var folderCalls = 0
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "folder", targetPageId = null),
                    state = emptyMap(),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = { folderCalls += 1 }
                )
            }
        }

        composeRule.onNodeWithTag("deck-control-control")
            .assertIsDisplayed()
            .performTouchInput { click() }

        composeRule.runOnIdle { assertEquals(0, folderCalls) }
    }

    @Test
    fun validFolderInvokesFolderCallbackOnce() {
        var folderCalls = 0
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "folder", targetPageId = "page-2"),
                    state = emptyMap(),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = { folderCalls += 1 }
                )
            }
        }

        composeRule.onNodeWithTag("deck-control-control")
            .assertIsDisplayed()
            .performTouchInput { click() }

        composeRule.runOnIdle { assertEquals(1, folderCalls) }
    }

    @Test
    fun actionableControlReportsPressedStateUntilTouchIsReleased() {
        composeRule.mainClock.autoAdvance = false
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "button"),
                    state = emptyMap(),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = {}
                )
            }
        }

        composeRule.onNodeWithTag("deck-control-control").performTouchInput { down(center) }
        composeRule.mainClock.advanceTimeBy(120)
        composeRule.onNodeWithTag("deck-control-control").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Нажата")
        )
        composeRule.onNodeWithTag("deck-control-control").performTouchInput { up() }
        composeRule.mainClock.advanceTimeBy(120)
        composeRule.onNodeWithTag("deck-control-control").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Готова")
        )
    }

    @Test
    fun oneRowSliderUsesCompactLayoutWithoutEmittingValue() {
        var sliderCalls = 0
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "slider", label = "Studio Volume"),
                    state = mapOf("value" to 42.0),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = { sliderCalls += 1 },
                    onFolder = {}
                )
            }
        }

        val controlBounds = composeRule.onNodeWithTag("deck-control-control")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        val labelBounds = composeRule.onNodeWithText("Studio Volume")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        val valueBounds = composeRule.onNodeWithText("42.0")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        val sliderBounds = composeRule.onNode(
            hasProgressBarRangeInfo(ProgressBarRangeInfo(42f, 0f..100f, 99))
        ).assertIsDisplayed().getUnclippedBoundsInRoot()

        assertTrue(abs(labelBounds.top.value - valueBounds.top.value) <= 2f)
        assertTrue(sliderBounds.top >= labelBounds.bottom)
        assertTrue(sliderBounds.bottom <= controlBounds.bottom)
        composeRule.runOnIdle { assertEquals(0, sliderCalls) }
    }

    @Test
    fun invalidSliderRangeFallsBackWithoutCrashing() {
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "slider", minimum = 50.0, maximum = 10.0),
                    state = mapOf("value" to 500.0),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = {}
                )
            }
        }
        composeRule.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo(100f, 0f..100f, 99))).assertIsDisplayed()
    }

    @Test
    fun nonFiniteSliderStateRendersSafeValueWithoutSending() {
        var calls = 0
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "slider"),
                    state = mapOf("value" to Double.NaN),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = { calls++ },
                    onFolder = {}
                )
            }
        }
        composeRule.onNodeWithText("0.0").assertIsDisplayed()
        composeRule.runOnIdle { assertEquals(0, calls) }
    }

    @Test
    fun sliderShowsRunningAndErrorFeedback() {
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "slider"),
                    state = mapOf("value" to 42.0, "running" to true, "error" to "Нет связи"),
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = {}
                )
            }
        }

        composeRule.onNodeWithText("…").assertIsDisplayed()
        composeRule.onNodeWithText("!").assertIsDisplayed()
        composeRule.onNodeWithText("Нет связи").assertIsDisplayed()
    }

    @Test
    fun cancelledSliderGestureAcceptsTheNextServerValue() {
        val sliderState = mutableStateOf<Map<String, Any?>>(mapOf("value" to 20.0))
        setThemedContent {
            Box(Modifier.size(width = 200.dp, height = 88.dp)) {
                AetherDeckControl(
                    control = control(type = "slider"),
                    state = sliderState.value,
                    dynamicValue = null,
                    asset = null,
                    onMissingAsset = {},
                    onTrigger = {},
                    onSlider = {},
                    onFolder = {}
                )
            }
        }

        composeRule.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo(20f, 0f..100f, 99)))
            .performTouchInput {
                down(centerLeft)
                moveTo(centerRight)
                cancel()
            }
        composeRule.runOnIdle { sliderState.value = mapOf("value" to 35.0) }
        composeRule.onNode(hasProgressBarRangeInfo(ProgressBarRangeInfo(35f, 0f..100f, 99))).assertIsDisplayed()
    }

    @Test
    fun longHeaderKeepsBackAndRefreshVisibleAtPortraitWidth() {
        val deckName = "A very long production control deck name"
        val pageName = "A deeply nested page with a long descriptive name"
        val page = DeckPage("page", pageName, 1, "#17151f", emptyList())
        val state = DeckUiState(
            activeDeckId = "deck",
            activePageId = "page",
            decks = listOf(AetherDeck("deck", deckName, "page", listOf(page))),
            canNavigateBack = true,
            needsFullSync = false
        )
        setThemedContent {
            Box(Modifier.size(width = 320.dp, height = 640.dp)) {
                AetherDeckTab(
                    state = state,
                    onSync = {},
                    onTrigger = {},
                    onSlider = { _, _ -> },
                    onNavigate = { _, _ -> },
                    onNavigateBack = {},
                    assetRevision = 0,
                    loadAsset = { null },
                    requestAsset = {}
                )
            }
        }

        composeRule.onNodeWithContentDescription("Назад").assertIsDisplayed()
        composeRule.onNodeWithContentDescription("Обновить").assertIsDisplayed()
        val pathBounds = composeRule.onNodeWithText("$deckName  /  $pageName")
            .assertIsDisplayed()
            .getUnclippedBoundsInRoot()
        assertTrue(
            "Path should remain one line, actual bounds: $pathBounds",
            pathBounds.bottom - pathBounds.top <= 40.dp
        )
    }

    private fun control(
        type: String,
        label: String = "Control",
        targetPageId: String? = null,
        minimum: Double = 0.0,
        maximum: Double = 100.0
    ) = DeckControl(
        id = "control",
        type = type,
        label = label,
        enabled = true,
        column = 0,
        row = 0,
        columnSpan = 1,
        rowSpan = 1,
        background = "#17151f",
        foreground = "#ffffff",
        stateBinding = null,
        iconKind = null,
        iconName = null,
        iconHash = null,
        actions = emptyList(),
        minimum = minimum,
        maximum = maximum,
        targetPageId = targetPageId
    )
}
