package com.example

import com.example.network.sanitizeIncomingFileName
import org.junit.Assert.assertEquals
import org.junit.Test

class IncomingFileNameTest {
    @Test
    fun stripsBothWindowsAndUnixPathComponentsAndUsesFallbackForRelativeNames() {
        assertEquals("test.txt", sanitizeIncomingFileName("..\\..\\test.txt", 7))
        assertEquals("photo.png", sanitizeIncomingFileName("../../photo.png", 7))
        assertEquals("downloaded_7.bin", sanitizeIncomingFileName("..\\..", 7))
    }
}
