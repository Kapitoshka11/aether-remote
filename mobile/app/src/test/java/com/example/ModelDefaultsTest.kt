package com.example

import com.example.model.ClipboardData
import com.example.model.HostConfig
import com.example.model.HostPlatform
import com.example.model.MediaState
import com.example.model.SystemStats
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ModelDefaultsTest {
    @Test
    fun `disconnected models never display fabricated PC data`() {
        assertEquals("", HostConfig().ip)
        assertEquals("", HostConfig().token)
        assertFalse(HostConfig().isSimulator)
        assertEquals(HostPlatform.UNKNOWN, HostConfig().platform)
        assertEquals(0f, SystemStats().cpu)
        assertEquals(0f, SystemStats().ram)
        assertEquals("", MediaState().trackTitle)
        assertEquals(0, MediaState().volume)
        assertEquals("", ClipboardData().text)
    }

    @Test
    fun `host platform accepts electron wire names`() {
        assertEquals(HostPlatform.LINUX, HostPlatform.fromWire("linux"))
        assertEquals(HostPlatform.WINDOWS, HostPlatform.fromWire("win32"))
        assertEquals(HostPlatform.WINDOWS, HostPlatform.fromWire("Windows 11"))
        assertEquals(HostPlatform.UNKNOWN, HostPlatform.fromWire(""))
    }
}
