package com.example

import com.example.network.validateIncomingFileOffer
import com.example.network.IncomingFileChunkDecision
import com.example.network.incomingFileChunkDecision
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IncomingFileOfferPolicyTest {
    @Test
    fun validatesMetadataBeforeShowingConfirmation() {
        val offer = validateIncomingFileOffer("transfer-1", "../report.txt", 42)
        assertEquals("report.txt", offer?.fileName)
        assertNull(validateIncomingFileOffer("", "report.txt", 42))
        assertNull(validateIncomingFileOffer("x".repeat(129), "report.txt", 42))
        assertNull(validateIncomingFileOffer("transfer-1", "x".repeat(256), 42))
        assertNull(validateIncomingFileOffer("transfer-1", "report.txt", 500L * 1024L * 1024L + 1))
    }

    @Test
    fun malformedChunkForActiveTransferAbortsOnlyThatTransfer() {
        assertEquals(
            IncomingFileChunkDecision.ACCEPT,
            incomingFileChunkDecision("transfer-1", "transfer-1", 4, 4, "ZGF0YQ==")
        )
        assertEquals(
            IncomingFileChunkDecision.ABORT_TRANSFER,
            incomingFileChunkDecision("transfer-1", "transfer-1", 2, 4, "ZGF0YQ==")
        )
        assertEquals(
            IncomingFileChunkDecision.ABORT_TRANSFER,
            incomingFileChunkDecision("transfer-1", "transfer-1", 4, 4, "")
        )
        assertEquals(
            IncomingFileChunkDecision.REJECT_CHUNK,
            incomingFileChunkDecision("unrelated", "transfer-1", 4, 4, "ZGF0YQ==")
        )
    }
}
