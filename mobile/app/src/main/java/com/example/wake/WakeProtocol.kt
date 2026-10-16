package com.example.wake

import android.util.Base64
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature

private val identifierPattern = Regex("^[0-9a-f]{32}$")

internal fun canonicalizeWakeRequest(request: WakeRequest): ByteArray = listOf(
    "AETHER_WAKE/1",
    "type=${request.type}",
    "groupId=${request.groupId}",
    "targetDeviceId=${request.targetDeviceId}",
    "senderDeviceId=${request.senderDeviceId}",
    "nonce=${request.nonce}",
    "issuedAt=${request.issuedAt}",
    "expiresAt=${request.expiresAt}"
).joinToString("\n").toByteArray(Charsets.UTF_8)

internal fun validateWakeRequest(request: WakeRequest, nowMs: Long): String? {
    if (request.version != 1 || request.type != "wake.request") return "invalid_version_or_type"
    if (
        listOf(request.groupId, request.targetDeviceId, request.senderDeviceId, request.nonce)
            .any { !identifierPattern.matches(it) }
    ) return "invalid_identifier"
    val ttl = request.expiresAt - request.issuedAt
    if (ttl !in 1..30_000) return "invalid_ttl"
    if (request.issuedAt > nowMs + 10_000) return "future_issued_at"
    if (nowMs - request.issuedAt > 40_000) return "stale"
    if (nowMs > request.expiresAt) return "expired"
    return null
}

internal fun signWakeRequest(request: WakeRequest, privateKey: PrivateKey): WakeRequest {
    require(validateWakeRequest(request, request.issuedAt) == null) { "invalid_wake_request" }
    val signature = Signature.getInstance("SHA256withECDSA").run {
        initSign(privateKey)
        update(canonicalizeWakeRequest(request))
        sign()
    }
    return request.copy(signature = Base64.encodeToString(signature, Base64.NO_WRAP))
}

internal fun verifyWakeRequest(request: WakeRequest, publicKey: PublicKey, nowMs: Long): Boolean {
    if (validateWakeRequest(request, nowMs) != null || request.signature.isNullOrBlank()) return false
    return runCatching {
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(canonicalizeWakeRequest(request))
            verify(Base64.decode(request.signature, Base64.NO_WRAP))
        }
    }.getOrDefault(false)
}
