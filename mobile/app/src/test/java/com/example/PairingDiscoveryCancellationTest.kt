package com.example

import com.example.ui.screens.receiveDatagramCancellable
import java.net.DatagramPacket
import java.net.DatagramSocket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingDiscoveryCancellationTest {
    @Test
    fun `cancelling discovery immediately closes its blocking UDP socket`() = runBlocking {
        val socket = DatagramSocket(0)
        val packet = DatagramPacket(ByteArray(32), 32)
        val receiver = launch(Dispatchers.IO) { receiveDatagramCancellable(socket, packet) }
        delay(50)

        withTimeout(1_000) { receiver.cancelAndJoin() }

        assertTrue(socket.isClosed)
    }
}
