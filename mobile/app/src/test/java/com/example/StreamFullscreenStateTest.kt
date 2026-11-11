package com.example

import com.example.ui.screens.StreamFullscreenState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamFullscreenStateTest {
    @Test
    fun enterRevealHideAndExitAreDeterministic() {
        val state = StreamFullscreenState()
        assertFalse(state.isFullscreen)
        state.enter()
        assertTrue(state.isFullscreen)
        assertTrue(state.controlsVisible)
        state.hideControls()
        assertFalse(state.controlsVisible)
        state.showControls()
        assertTrue(state.controlsVisible)
        state.exit()
        assertFalse(state.isFullscreen)
        assertFalse(state.controlsVisible)
    }

    @Test
    fun unavailableStreamForcesFullscreenExit() {
        val state = StreamFullscreenState()
        state.enter()
        state.updateAvailability(isStreaming = false, hasFrame = true)
        assertFalse(state.isFullscreen)
        state.enter()
        state.updateAvailability(isStreaming = true, hasFrame = false)
        assertFalse(state.isFullscreen)
    }
}
