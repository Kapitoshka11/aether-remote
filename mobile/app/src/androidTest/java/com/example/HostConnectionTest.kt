package com.example

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.model.ConnectionStatus
import com.example.network.PcWebSocketManager
import java.io.ByteArrayInputStream
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HostConnectionTest {
    @Test
    fun approvedTlsConnectionSynchronizesDeckAndSendsTwoFiles() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("aetherHostFixture") == "true")
        val descriptor = instrumentation.uiAutomation.executeShellCommand("cat /data/local/tmp/aether-host-fixture.json")
        val config = android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().use {
            JSONObject(it.readText())
        }
        lateinit var manager: PcWebSocketManager
        instrumentation.runOnMainSync { manager = PcWebSocketManager(instrumentation.targetContext) }
        try {
            instrumentation.runOnMainSync {
                manager.connect("10.0.2.2", config.getInt("port"), config.getString("pin"),
                    advertisedTlsFingerprint = config.getString("fingerprint"))
            }
            await("Host approval") { manager.connectionStatus.value == ConnectionStatus.CONNECTED }
            await("Deck synchronization") { manager.deckState.value.decks.isNotEmpty() }
            repeat(2) { index ->
                val name = "${config.getString("prefix")}-$index.txt"
                val bytes = "Aether Android 2.0.0 transfer $index".toByteArray()
                manager.sendFileStreamToPc(name, bytes.size.toLong(), ByteArrayInputStream(bytes))
                await("File completion $index") {
                    manager.fileTransferProgress.value?.let { it.fileName == name && it.isCompleted } == true
                }
                assertEquals(bytes.size.toLong(), manager.fileTransferProgress.value?.fileSize)
            }
            manager.disconnect()
            assertEquals(ConnectionStatus.DISCONNECTED, manager.connectionStatus.value)
        } finally {
            instrumentation.runOnMainSync { manager.destroy() }
        }
    }

    private fun await(label: String, condition: () -> Boolean) {
        val deadline = System.nanoTime() + 30_000_000_000L
        while (!condition()) {
            check(System.nanoTime() < deadline) { "$label timed out" }
            Thread.sleep(100)
        }
    }
}
