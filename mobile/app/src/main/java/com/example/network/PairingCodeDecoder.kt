package com.example.network

internal fun decodePairingHostIp(code: String, subnetPrefix: String): String? {
    if (code.length !in listOf(9, 12) || code.any { !it.isDigit() }) return null
    val prefixParts = subnetPrefix.trimEnd('.').split('.')
    if (prefixParts.size != 2 || prefixParts.any { it.toIntOrNull() !in 0..255 }) return null
    val third = code.substring(0, 3).toIntOrNull()?.takeIf { it in 0..255 } ?: return null
    val fourth = code.substring(3, 6).toIntOrNull()?.takeIf { it in 0..255 } ?: return null
    return "${prefixParts[0]}.${prefixParts[1]}.$third.$fourth"
}
