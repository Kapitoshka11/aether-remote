package com.example.network

import java.net.InetAddress

internal fun isLoopbackHostname(value: String): Boolean = value.trim().lowercase().removeSurrounding("[", "]") in
    setOf("localhost", "127.0.0.1", "::1")

internal fun privateLanIpv4OrNull(value: String): String? {
    val parts = value.trim().split('.')
    if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || it.any { char -> !char.isDigit() } }) return null
    val octets = parts.map { it.toIntOrNull() ?: return null }
    if (octets.any { it !in 0..255 }) return null
    val canonical = octets.joinToString(".")
    val address = runCatching {
        InetAddress.getByAddress(octets.map(Int::toByte).toByteArray())
    }.getOrNull() ?: return null
    return canonical.takeIf { address.isSiteLocalAddress || address.isLoopbackAddress }
}

/**
 * Normalizes a user-selected endpoint for a certificate-pinned connection.
 * Discovery remains LAN-only; this policy is for explicit VPN, DNS, or public endpoints.
 */
internal fun remoteHostOrNull(value: String): String? {
    val candidate = value.trim().trimEnd('.').lowercase()
    if (candidate.isEmpty() || candidate.length > 253) return null
    privateLanIpv4OrNull(candidate)?.let { return it }

    val ipv4Parts = candidate.split('.')
    if (ipv4Parts.size == 4 && ipv4Parts.all { part ->
            part.isNotEmpty() && part.length <= 3 && part.all(Char::isDigit)
        }) {
        val octets = ipv4Parts.map { it.toIntOrNull() ?: return null }
        if (octets.any { it !in 0..255 }) return null
        val address = runCatching {
            InetAddress.getByAddress(octets.map(Int::toByte).toByteArray())
        }.getOrNull() ?: return null
        return octets.joinToString(".").takeUnless {
            address.isAnyLocalAddress || address.isMulticastAddress
        }
    }

    val labels = candidate.split('.')
    if (labels.size > 4 && labels.take(4).all { label -> label.isNotEmpty() && label.all(Char::isDigit) }) return null
    if (labels.any { label ->
            label.isEmpty() || label.length > 63 || label.first() == '-' || label.last() == '-' ||
                label.any { char -> !char.isLetterOrDigit() && char != '-' }
        }) return null
    return candidate
}
