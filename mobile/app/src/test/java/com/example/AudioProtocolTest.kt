package com.example

import com.example.network.isAudioStreamActive
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioProtocolTest {
    @Test
    fun pendingStatusKeepsAudioEnabledUntilErrorOrDisable() {
        assertTrue(isAudioStreamActive(true, "PENDING"))
        assertTrue(isAudioStreamActive(true, "SUCCESS"))
        assertFalse(isAudioStreamActive(true, "ERROR"))
        assertFalse(isAudioStreamActive(false, "SUCCESS"))
    }
}
