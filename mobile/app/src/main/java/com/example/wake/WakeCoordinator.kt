package com.example.wake

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.security.SecureRandom

sealed interface WakeRemoteEvent {
    data object Delivered : WakeRemoteEvent
    data object Online : WakeRemoteEvent
    data class Failed(val code: String) : WakeRemoteEvent
}

fun interface WakeRemoteTransport {
    suspend fun wake(enrollment: WakeEnrollment, request: WakeRequest, onEvent: (WakeRemoteEvent) -> Unit)
}

class WakeCoordinator(
    private val identity: WakeIdentity,
    private val sign: (WakeRequest) -> WakeRequest,
    private val localWake: (String) -> Unit,
    private val remoteTransport: WakeRemoteTransport,
    private val clock: () -> Long = System::currentTimeMillis,
    private val randomBytes: (Int) -> ByteArray = { ByteArray(it).also(SecureRandom()::nextBytes) },
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) {
    private val mutex = Mutex()
    private val active = mutableSetOf<String>()
    private val _state = MutableStateFlow<Map<String, WakeTargetState>>(emptyMap())
    val state: StateFlow<Map<String, WakeTargetState>> = _state.asStateFlow()

    suspend fun wake(enrollment: WakeEnrollment, macAddress: String) {
        val accepted = mutex.withLock { active.add(enrollment.targetDeviceId) }
        if (!accepted) return
        try {
            update(enrollment.targetDeviceId, WakeTargetState(WakeStage.DISCOVERING, WakeRouteKind.BRIDGE))
            val localDelivered = runCatching { withContext(dispatcher) { localWake(macAddress) } }.isSuccess
            val now = clock()
            val request = sign(WakeRequest(
                groupId = enrollment.groupId,
                targetDeviceId = enrollment.targetDeviceId,
                senderDeviceId = identity.deviceId,
                nonce = randomBytes(16).joinToString("") { "%02x".format(it.toInt() and 0xff) },
                issuedAt = now,
                expiresAt = now + 30_000
            ))
            update(enrollment.targetDeviceId, WakeTargetState(WakeStage.SENT, WakeRouteKind.BRIDGE))
            runCatching { remoteTransport.wake(enrollment, request) { event ->
                when (event) {
                    WakeRemoteEvent.Delivered -> update(enrollment.targetDeviceId, WakeTargetState(WakeStage.STARTING, WakeRouteKind.BRIDGE))
                    WakeRemoteEvent.Online -> update(enrollment.targetDeviceId, WakeTargetState(WakeStage.ONLINE, WakeRouteKind.BRIDGE))
                    is WakeRemoteEvent.Failed -> update(enrollment.targetDeviceId, WakeTargetState(WakeStage.FAILED, WakeRouteKind.BRIDGE, event.code))
                }
            } }.onFailure { error ->
                update(enrollment.targetDeviceId, WakeTargetState(
                    if (localDelivered) WakeStage.STARTING else WakeStage.FAILED,
                    if (localDelivered) WakeRouteKind.DIRECT_UDP else WakeRouteKind.BRIDGE,
                    if (error is kotlinx.coroutines.TimeoutCancellationException || error is java.net.SocketTimeoutException) "remote_timeout" else "relay_unavailable"
                ))
            }
        } finally {
            mutex.withLock { active.remove(enrollment.targetDeviceId) }
        }
    }

    private fun update(target: String, value: WakeTargetState) {
        _state.value = _state.value + (target to value)
    }
}
