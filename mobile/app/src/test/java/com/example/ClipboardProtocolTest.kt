package com.example

import com.example.network.ClipboardMessageKind
import com.example.network.clipboardMessageKind
import org.junit.Assert.assertEquals
import org.junit.Test

class ClipboardProtocolTest {
    @Test
    fun `write acknowledgements are not treated as PC clipboard content`() {
        assertEquals(ClipboardMessageKind.WRITE_ACK, clipboardMessageKind("CLIPBOARD_WRITE_ACK", ""))
        assertEquals(ClipboardMessageKind.WRITE_ACK, clipboardMessageKind("CLIPBOARD_RESPONSE", ""))
        assertEquals(ClipboardMessageKind.WRITE_ACK, clipboardMessageKind("CLIPBOARD_OK", ""))
        assertEquals(ClipboardMessageKind.WRITE_ACK, clipboardMessageKind("", "CLIPBOARD_RESPONSE"))
    }

    @Test
    fun `read responses and history events remain PC clipboard content`() {
        assertEquals(ClipboardMessageKind.PC_CONTENT, clipboardMessageKind("CLIPBOARD", ""))
        assertEquals(ClipboardMessageKind.PC_CONTENT, clipboardMessageKind("CLIPBOARD_TEXT", ""))
        assertEquals(ClipboardMessageKind.PC_CONTENT, clipboardMessageKind("CLIPBOARD_ITEM", ""))
    }
}
