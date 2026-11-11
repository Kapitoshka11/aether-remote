package com.example.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.IOException
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.util.Collections
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject

internal fun isNonLanInterfaceName(name: String): Boolean {
    val lower = name.lowercase()
    return lower.startsWith("rmnet") ||
        lower.startsWith("v4-rmnet") ||
        lower.startsWith("tun") ||
        lower.startsWith("utun") ||
        lower.startsWith("tap") ||
        lower.startsWith("wg") ||
        lower.startsWith("ppp") ||
        lower.startsWith("tailscale") ||
        lower.startsWith("slarp") ||
        lower.startsWith("vethernet") ||
        lower.startsWith("vmware") ||
        lower.startsWith("vbox") ||
        lower.startsWith("docker") ||
        lower.startsWith("dummy") ||
        lower.startsWith("clat") ||
        lower.contains("virtual") ||
        lower.contains("vpn")
}

internal suspend fun fetchVerifiedHost(
    context: Context,
    client: OkHttpClient,
    ip: String,
    port: Int
): JSONObject? {
    if (port !in 1..65535) return null
    val host = privateLanIpv4OrNull(ip) ?: return null
    val peerFingerprint = AtomicReference<String?>(null)
    // Discovery sends no credentials. Its certificate must never become an authentication pin.
    val secureClient = buildTofuTlsClient(
        lanClient(context, client, host),
        null,
        peerFingerprint::set,
        allowUnpinnedDiscovery = true
    )
    val request = Request.Builder().url("https://$host:$port/health").get().build()
    return suspendCancellableCoroutine { continuation ->
        val call = secureClient.newCall(request)
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) continuation.resume(null)
            }

            override fun onResponse(call: Call, response: Response) {
                val verified = response.use {
                    if (!it.isSuccessful) return@use null
                    val json = runCatching { JSONObject(it.body?.string().orEmpty()) }.getOrNull()
                        ?: return@use null
                    val statusOk = json.optString("status") == "ok"
                    val versionOk = json.optString("protocolVersion") == "2.0"
                    if (!statusOk || !versionOk) return@use null
                    json.remove("tlsFingerprint")
                    json
                }
                if (continuation.isActive) continuation.resume(verified)
            }
        })
    }
}

internal fun isPreferredLanInterfaceName(name: String): Boolean {
    val lower = name.lowercase()
    return lower.startsWith("wlan") ||
        lower.startsWith("ap") ||
        lower.startsWith("swlan") ||
        lower.startsWith("rndis") ||
        lower.startsWith("eth") ||
        lower.startsWith("en")
}

internal fun activeLanSubnetPrefixes(context: Context): List<String> {
    val ordered = linkedSetOf<String>()
    try {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        if (manager != null) {
            val active = manager.activeNetwork
            val candidates = buildList {
                if (active != null) add(active)
                addAll(manager.allNetworks)
            }.distinct()
            candidates.forEach { net ->
                val caps = runCatching { manager.getNetworkCapabilities(net) }.getOrNull() ?: return@forEach
                val isPhysicalLan = !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                    (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
                if (!isPhysicalLan) return@forEach
                runCatching { manager.getLinkProperties(net)?.linkAddresses.orEmpty() }
                    .getOrDefault(emptyList())
                    .forEach { link ->
                        val addr = link.address
                        if (addr is Inet4Address && !addr.isLoopbackAddress && addr.isSiteLocalAddress) {
                            addr.hostAddress?.substringBeforeLast('.')?.plus(".")?.let(ordered::add)
                        }
                    }
            }
        }
    } catch (_: Exception) {}
    try {
        val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
        val preferred = mutableListOf<String>()
        val otherLan = mutableListOf<String>()
        for (intf in interfaces) {
            if (!intf.isUp || intf.isLoopback || isNonLanInterfaceName(intf.name)) continue
            val isPreferred = isPreferredLanInterfaceName(intf.name)
            for (addr in Collections.list(intf.inetAddresses)) {
                if (!addr.isLoopbackAddress && addr is Inet4Address && addr.isSiteLocalAddress) {
                    val prefix = addr.hostAddress?.substringBeforeLast('.')?.plus(".") ?: continue
                    if (isPreferred) preferred.add(prefix) else otherLan.add(prefix)
                }
            }
        }
        ordered.addAll(preferred)
        ordered.addAll(otherLan)
    } catch (_: Exception) {}
    return ordered.toList()
}

internal fun bindSocketToPhysicalLan(context: Context, socket: DatagramSocket) {
    try {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
        val active = manager.activeNetwork
        val candidates = buildList {
            if (active != null) add(active)
            addAll(manager.allNetworks)
        }.distinct()
        val lanNet = candidates.firstOrNull { net ->
            val caps = runCatching { manager.getNetworkCapabilities(net) }.getOrNull() ?: return@firstOrNull false
            !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
        }
        if (lanNet != null) {
            runCatching { lanNet.bindSocket(socket) }
        }
    } catch (_: Exception) {}
}

internal fun activeLanBroadcastAddresses(context: Context): List<InetAddress> {
    val addresses = linkedSetOf<InetAddress>()
    try {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        manager?.allNetworks?.forEach { net ->
            val caps = runCatching { manager.getNetworkCapabilities(net) }.getOrNull() ?: return@forEach
            val isPhysicalLan = !caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
            if (!isPhysicalLan) return@forEach
            runCatching { manager.getLinkProperties(net)?.linkAddresses.orEmpty() }
                .getOrDefault(emptyList())
                .forEach { link ->
                    val v4 = link.address as? Inet4Address ?: return@forEach
                    val prefix = link.prefixLength
                    if (!v4.isLoopbackAddress && v4.isSiteLocalAddress && prefix in 1..30) {
                        val raw = v4.address
                        val ipInt = ((raw[0].toInt() and 0xff) shl 24) or
                            ((raw[1].toInt() and 0xff) shl 16) or
                            ((raw[2].toInt() and 0xff) shl 8) or
                            (raw[3].toInt() and 0xff)
                        val hostMask = ((1L shl (32 - prefix)) - 1L).toInt()
                        val bcast = ipInt or hostMask
                        val bytes = byteArrayOf(
                            ((bcast ushr 24) and 0xff).toByte(),
                            ((bcast ushr 16) and 0xff).toByte(),
                            ((bcast ushr 8) and 0xff).toByte(),
                            (bcast and 0xff).toByte()
                        )
                        runCatching { InetAddress.getByAddress(bytes) }.getOrNull()?.let(addresses::add)
                    }
                }
        }
    } catch (_: Exception) {}
    activeLanSubnetPrefixes(context).forEach { prefix ->
        runCatching { InetAddress.getByName("${prefix}255") }.getOrNull()?.let(addresses::add)
    }
    runCatching { InetAddress.getByName("255.255.255.255") }.getOrNull()?.let(addresses::add)
    return addresses.toList()
}

internal fun lanClient(context: Context, base: OkHttpClient, host: String): OkHttpClient {
    val address = privateLanIpv4OrNull(host) ?: return base
    val target = address.split('.').map(String::toInt)
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return base
    // Bind only on-link LAN traffic. Private addresses may also belong to a remote VPN subnet.
    val network = try {
        manager.allNetworks.firstOrNull { candidate ->
            val capabilities = manager.getNetworkCapabilities(candidate) ?: return@firstOrNull false
            !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN) &&
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN) &&
                (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) &&
                manager.getLinkProperties(candidate)?.linkAddresses.orEmpty().any { link ->
                    val local = link.address.address
                    local.size == 4 && link.prefixLength in 1..32 && target.indices.all { index ->
                        val bits = (link.prefixLength - index * 8).coerceIn(0, 8)
                        val mask = (0xff shl (8 - bits)) and 0xff
                        (target[index] and mask) == (local[index].toInt() and mask)
                    }
                }
        }
    } catch (_: SecurityException) {
        null
    } ?: return base
    return base.newBuilder()
        .socketFactory(network.socketFactory)
        .proxy(Proxy.NO_PROXY)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
}
