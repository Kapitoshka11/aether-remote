package com.example

import com.example.network.isInboundTextWithinLimit
import com.example.network.hasSafeJsonNesting
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InboundPayloadPolicyTest {
    @Test
    fun oversizedTextMessagesAreRejectedBeforeJsonParsing() {
        assertTrue(isInboundTextWithinLimit("x".repeat(12 * 1024 * 1024)))
        assertFalse(isInboundTextWithinLimit("x".repeat(12 * 1024 * 1024 + 1)))
    }

    @Test
    fun excessiveOrMalformedJsonNestingIsRejectedBeforeParsing() {
        assertTrue(hasSafeJsonNesting("{\"text\":\"[not nesting]\",\"items\":[1]}"))
        assertFalse(hasSafeJsonNesting("[".repeat(65) + "]".repeat(65)))
        assertFalse(hasSafeJsonNesting("{]"))
    }
}
