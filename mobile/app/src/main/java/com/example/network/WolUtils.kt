package com.example.network

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

object WolUtils {
    fun buildMagicPacket(macAddress: String): ByteArray {
        val cleanMac = macAddress.replace(":", "").replace("-", "").lowercase()
        require(Regex("^[0-9a-f]{12}$").matches(cleanMac)) { "Неверный формат MAC-адреса" }
        val macBytes = cleanMac.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        return ByteArray(102).apply {
            for (index in 0 until 6) this[index] = 0xff.toByte()
            for (copy in 0 until 16) System.arraycopy(macBytes, 0, this, 6 + copy * 6, 6)
        }
    }

    fun sendMagicPacket(macAddress: String) {
        val bytes = buildMagicPacket(macAddress)
        val targets = linkedSetOf("255.255.255.255")
        runCatching {
            Collections.list(NetworkInterface.getNetworkInterfaces())
                .filter { it.isUp && !it.isLoopback }
                .flatMap { it.interfaceAddresses }
                .mapNotNull { interfaceAddress ->
                    val address = interfaceAddress.address as? Inet4Address ?: return@mapNotNull null
                    directedBroadcastAddress(address.hostAddress ?: return@mapNotNull null, interfaceAddress.networkPrefixLength.toInt())
                }
                .forEach(targets::add)
        }
        DatagramSocket().use { socket ->
            socket.broadcast = true
            var sentTargets = 0
            targets.forEach { target ->
                if (runCatching { socket.send(DatagramPacket(bytes, bytes.size, InetAddress.getByName(target), 9)) }.isSuccess) sentTargets++
            }
            check(sentTargets > 0) { "Не удалось отправить WOL-пакет ни в одну сеть" }
        }
    }

    internal fun directedBroadcastAddress(ipAddress: String, prefixLength: Int): String? {
        if (prefixLength !in 0..32) return null
        if (prefixLength == 32) return "255.255.255.255"
        val octets = ipAddress.split('.').map { it.toIntOrNull() ?: return null }
        if (octets.size != 4 || octets.any { it !in 0..255 }) return null
        val address = octets.fold(0L) { value, octet -> (value shl 8) or octet.toLong() }
        val mask = if (prefixLength == 0) 0L else (0xffffffffL shl (32 - prefixLength)) and 0xffffffffL
        val broadcast = (address or mask.inv()) and 0xffffffffL
        return (24 downTo 0 step 8).joinToString(".") { shift -> ((broadcast shr shift) and 0xff).toString() }
    }
}
