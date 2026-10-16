package com.example.ui.screens

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

internal class StreamFullscreenState {
    var isFullscreen: Boolean by mutableStateOf(false)
        private set
    var controlsVisible: Boolean by mutableStateOf(false)
        private set

    fun enter() {
        isFullscreen = true
        controlsVisible = true
    }

    fun showControls() {
        if (isFullscreen) controlsVisible = true
    }

    fun hideControls() {
        controlsVisible = false
    }

    fun exit() {
        isFullscreen = false
        controlsVisible = false
    }

    fun updateAvailability(isStreaming: Boolean, hasFrame: Boolean) {
        if (!isStreaming || !hasFrame) exit()
    }
}
