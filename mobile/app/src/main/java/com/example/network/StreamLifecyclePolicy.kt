package com.example.network

internal class StreamLifecyclePolicy {
    data class Selection(val live: Boolean = false, val audio: Boolean = false)

    private var suspended = Selection()

    fun pause(live: Boolean, audio: Boolean): Selection {
        suspended = Selection(live, audio)
        return suspended
    }

    fun resume(connected: Boolean): Selection {
        val selection = if (connected) suspended else Selection()
        suspended = Selection()
        return selection
    }
}
