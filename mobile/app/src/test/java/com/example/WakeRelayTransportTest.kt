package com.example

import com.example.wake.WakeEnrollment
import com.example.wake.WakeRelayTransport
import com.example.wake.WakeRemoteEvent
import com.example.wake.WakeRequest
import com.example.wake.WakeSocket
import com.example.wake.WakeSocketFactory
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class WakeRelayTransportTest {
    @Test fun sendsRequestAndWaitsForMatchingOnlineEvent() = runTest {
        lateinit var socket: FakeSocket
        val transport = WakeRelayTransport(WakeSocketFactory { url, listener -> FakeSocket(url, listener).also { socket = it } })
        val enrollment = WakeEnrollment("11".repeat(16), "22".repeat(16), "https://relay.example", "{\"deviceId\":\"${"33".repeat(16)}\"}", "owner")
        val request = WakeRequest(groupId = enrollment.groupId, targetDeviceId = enrollment.targetDeviceId, senderDeviceId = "33".repeat(16), nonce = "44".repeat(16), issuedAt = 1, expiresAt = 30_001, signature = "sig")
        val events = mutableListOf<WakeRemoteEvent>()
        val result = async { transport.wake(enrollment, request) { events += it } }
        runCurrent()
        socket.listener.onOpen()
        assertTrue(socket.sent.single().contains("wake.request"))
        socket.listener.onMessage("{\"type\":\"wake.delivery\",\"nonce\":\"${request.nonce}\",\"status\":\"delivered\"}")
        socket.listener.onMessage("{\"type\":\"host.online\",\"deviceId\":\"${enrollment.targetDeviceId}\"}")
        result.await()
        assertEquals(listOf(WakeRemoteEvent.Delivered, WakeRemoteEvent.Online), events)
        assertTrue(socket.url.startsWith("wss://relay.example/v1/groups/${enrollment.groupId}/socket?"))
    }

    @Test fun rejectionFailsImmediately() = runTest {
        lateinit var socket: FakeSocket
        val transport = WakeRelayTransport(WakeSocketFactory { url, listener -> FakeSocket(url, listener).also { socket = it } })
        val enrollment = WakeEnrollment("11".repeat(16), "22".repeat(16), "https://relay.example", "{\"deviceId\":\"${"33".repeat(16)}\"}", "owner")
        val request = WakeRequest(groupId = enrollment.groupId, targetDeviceId = enrollment.targetDeviceId, senderDeviceId = "33".repeat(16), nonce = "44".repeat(16), issuedAt = 1, expiresAt = 30_001, signature = "sig")
        val events = mutableListOf<WakeRemoteEvent>()
        val result = async { transport.wake(enrollment, request) { events += it } }
        runCurrent(); socket.listener.onOpen()
        socket.listener.onMessage("{\"type\":\"wake.delivery\",\"nonce\":\"${request.nonce}\",\"status\":\"rejected\",\"code\":\"unknown_target\"}")
        result.await()
        assertEquals(listOf(WakeRemoteEvent.Failed("unknown_target")), events)
    }

    private class FakeSocket(val url: String, val listener: com.example.wake.WakeSocketListener) : WakeSocket {
        val sent = mutableListOf<String>()
        override fun send(text: String) { sent += text }
        override fun close() = Unit
    }
}
