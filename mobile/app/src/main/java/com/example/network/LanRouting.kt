package com.example.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.net.Proxy
import okhttp3.OkHttpClient

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
