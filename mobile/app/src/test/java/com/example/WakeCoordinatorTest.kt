package com.example

import com.example.wake.WakeCoordinator
import com.example.wake.WakeEnrollment
import com.example.wake.WakeIdentity
import com.example.wake.WakeRemoteEvent
import com.example.wake.WakeRemoteTransport
import com.example.wake.WakeRouteKind
import com.example.wake.WakeStage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WakeCoordinatorTest {
    @Test fun sendsOneSignedRemoteRequestAndCompletesOnPresence() = runTest {
        val requests = mutableListOf<com.example.wake.WakeRequest>()
        val transport = WakeRemoteTransport { _, request, onEvent ->
            requests += request
            onEvent(WakeRemoteEvent.Delivered)
            onEvent(WakeRemoteEvent.Online)
        }
        val enrollment = WakeEnrollment("11".repeat(16), "22".repeat(16), "https://relay.example", "{}", "owner")
        val coordinator = WakeCoordinator(
            identity = WakeIdentity("33".repeat(16), byteArrayOf(1)),
            sign = { it.copy(signature = "signed") },
            localWake = { },
            remoteTransport = transport,
            clock = { 1_700_000_000_000 },
            randomBytes = { ByteArray(16) { 0x44 } },
            dispatcher = StandardTestDispatcher(testScheduler)
        )
        val first = async { coordinator.wake(enrollment, "AA:BB:CC:DD:EE:FF") }
        val duplicate = async { coordinator.wake(enrollment, "AA:BB:CC:DD:EE:FF") }
        testScheduler.advanceUntilIdle()
        first.await(); duplicate.await()
        assertEquals(1, requests.size)
        assertEquals("signed", requests.single().signature)
        assertEquals(WakeStage.ONLINE, coordinator.state.value[enrollment.targetDeviceId]?.stage)
        assertEquals(WakeRouteKind.BRIDGE, coordinator.state.value[enrollment.targetDeviceId]?.route)
    }

    @Test fun reportsRelayTimeoutAsFailure() = runTest {
        val enrollment = WakeEnrollment("11".repeat(16), "22".repeat(16), "https://relay.example", "{}", "owner")
        val coordinator = WakeCoordinator(
            identity = WakeIdentity("33".repeat(16), byteArrayOf(1)),
            sign = { it.copy(signature = "signed") },
            localWake = { },
            remoteTransport = WakeRemoteTransport { _, _, _ -> throw java.net.SocketTimeoutException("timeout") },
            dispatcher = StandardTestDispatcher(testScheduler)
        )
        val result = async { coordinator.wake(enrollment, "AA:BB:CC:DD:EE:FF") }
        testScheduler.advanceUntilIdle()
        result.await()
        assertEquals(WakeStage.STARTING, coordinator.state.value[enrollment.targetDeviceId]?.stage)
        assertEquals("remote_timeout", coordinator.state.value[enrollment.targetDeviceId]?.errorCode)
    }
}
