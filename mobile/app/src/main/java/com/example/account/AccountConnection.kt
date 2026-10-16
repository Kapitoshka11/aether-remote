package com.example.account

import java.util.UUID

class AccountConnection(
    val host: AccountDevice,
    val identity: AccountIdentity,
    var grant: AccountGrant?,
    var accessToken: String?,
    val onGrant: (AccountGrant) -> Unit,
    val sessionId: String = UUID.randomUUID().toString(),
    val bridge: AccountRelayBridge? = null,
    val openRelay: (suspend () -> AccountConnection)? = null,
    val refresh: (suspend () -> AccountConnection)? = null
) {
    val transport: String get() = if (bridge == null) "lan" else "relay"
    @Volatile var transportOpened: Boolean = false
    var proofSent: Boolean = false
    var enrolling: Boolean = false
}
