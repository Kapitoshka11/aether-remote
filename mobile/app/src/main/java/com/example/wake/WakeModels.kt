package com.example.wake

enum class WakeStage {
    IDLE,
    DISCOVERING,
    SENT,
    STARTING,
    ONLINE,
    FAILED
}

enum class WakeRouteKind {
    BRIDGE,
    ROUTER,
    DIRECT_UDP
}

data class WakeRequest(
    val version: Int = 1,
    val type: String = "wake.request",
    val groupId: String,
    val targetDeviceId: String,
    val senderDeviceId: String,
    val nonce: String,
    val issuedAt: Long,
    val expiresAt: Long,
    val signature: String? = null
)

data class WakeTargetState(
    val stage: WakeStage = WakeStage.IDLE,
    val route: WakeRouteKind? = null,
    val errorCode: String? = null
)
