package com.example

import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class ConciseUiCopyTest {
    @Test
    fun powerScreenDoesNotExposeImplementationCommands() {
        val source = File(System.getProperty("user.dir"), "src/main/java/com/example/ui/screens/PowerSecurityTab.kt").readText()
        listOf("shutdown /s /t 0", "shutdown /r /t 0", "LockWorkStation", "SetSuspendState", "Aether Wake Bridge").forEach {
            assertFalse("Technical copy remains visible: $it", source.contains(it))
        }
    }
}
