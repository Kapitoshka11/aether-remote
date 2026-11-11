package com.example

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingQrUiTest {
    @Test
    fun pairingUsesInlineScannerInsteadOfFullscreenContract() {
        val screen = File("src/main/java/com/example/ui/screens/PairingGateScreen.kt").readText()
        val scanner = File("src/main/java/com/example/ui/screens/InlineQrScanner.kt")

        assertTrue(scanner.exists())
        assertTrue(screen.contains("InlineQrScanner("))
        assertFalse(screen.contains("ScanContract"))
        assertFalse(screen.contains("ScanOptions"))
    }
}
