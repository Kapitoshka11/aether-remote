package com.example

import com.example.ui.screens.AetherDeckOrientationVisitState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AetherDeckOrientationTest {
    @Test
    fun promptAppearsOnPortraitVisit() {
        val state = AetherDeckOrientationVisitState()

        assertTrue(state.shouldShow(isPortrait = true))
    }

    @Test
    fun promptDoesNotRepeatAfterBeingHandledInTheSameVisit() {
        val state = AetherDeckOrientationVisitState()

        state.markHandled()

        assertFalse(state.shouldShow(isPortrait = true))
    }

    @Test
    fun promptAppearsAgainAfterLeavingTheDeck() {
        val state = AetherDeckOrientationVisitState()
        state.markHandled()

        state.leave()

        assertTrue(state.shouldShow(isPortrait = true))
    }

    @Test
    fun promptDoesNotAppearInLandscape() {
        val state = AetherDeckOrientationVisitState()

        assertFalse(state.shouldShow(isPortrait = false))
    }

    @Test
    fun dashboardIntegratesTheOrientationPromptAndRestoresOrientation() {
        val dashboardSource = File(
            "src/main/java/com/example/ui/main/MainDashboardScreen.kt"
        ).readText()

        assertTrue(dashboardSource.contains("AetherDeckOrientationPrompt("))
        assertTrue(dashboardSource.contains("SCREEN_ORIENTATION_SENSOR_LANDSCAPE"))
        assertTrue(dashboardSource.contains("SCREEN_ORIENTATION_UNSPECIFIED"))
    }
}
