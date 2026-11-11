package com.example

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkAddress
import android.net.LinkProperties
import android.net.NetworkCapabilities
import androidx.test.core.app.ApplicationProvider
import com.example.network.lanClient
import java.net.InetAddress
import java.net.Socket
import javax.net.SocketFactory
import okhttp3.OkHttpClient
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.util.ReflectionHelpers
import org.robolectric.util.ReflectionHelpers.ClassParameter

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class LanRoutingTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val base = OkHttpClient()
    private val wifiSocketFactory = object : SocketFactory() {
        override fun createSocket(): Socket = error("Routing must not open sockets")
        override fun createSocket(host: String, port: Int): Socket = createSocket()
        override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = createSocket()
        override fun createSocket(host: InetAddress, port: Int): Socket = createSocket()
        override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = createSocket()
    }

    @Before
    fun setUp() {
        shadowOf(manager).clearAllNetworks()
        addNetwork(100, NetworkCapabilities.TRANSPORT_VPN, "10.8.0.2/24")
    }

    private fun addNetwork(id: Int, transport: Int, address: String) {
        val network = ShadowNetwork.newInstance(id)
        shadowOf(network).setSocketFactory(wifiSocketFactory)
        shadowOf(manager).addNetwork(network, null)
        shadowOf(manager).setNetworkCapabilities(network, NetworkCapabilities().apply {
            shadowOf(this).addTransportType(transport)
            if (transport == NetworkCapabilities.TRANSPORT_VPN) {
                shadowOf(this).removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            }
        })
        shadowOf(manager).setLinkProperties(network, LinkProperties().apply {
            val linkAddress = ReflectionHelpers.callConstructor(LinkAddress::class.java,
                ClassParameter.from(String::class.java, address))
            ReflectionHelpers.callInstanceMethod<Boolean>(this, "addLinkAddress",
                ClassParameter.from(LinkAddress::class.java, linkAddress))
        })
    }

    @Test
    fun `local PC uses physical wifi socket factory even with VPN available`() {
        addNetwork(101, NetworkCapabilities.TRANSPORT_WIFI, "192.168.1.2/24")
        val client = lanClient(context, base, "192.168.1.50")
        assertNotSame(base.socketFactory, client.socketFactory)
        assertSame(wifiSocketFactory, client.socketFactory)
        assertSame(java.net.Proxy.NO_PROXY, client.proxy)
    }

    @Test
    fun `VPN private address and other subnets keep default routing`() {
        addNetwork(101, NetworkCapabilities.TRANSPORT_WIFI, "192.168.1.2/24")
        for (host in listOf("10.8.0.10", "192.168.2.50", "127.0.0.1", "example.com", "8.8.8.8")) {
            assertSame(base, lanClient(context, base, host))
        }
    }

    @Test
    fun `ethernet without internet capability supports actual subnet mask`() {
        addNetwork(102, NetworkCapabilities.TRANSPORT_ETHERNET, "172.20.8.2/23")
        assertNotSame(base, lanClient(context, base, "172.20.9.50"))
        assertSame(base, lanClient(context, base, "172.20.10.50"))
    }

    @Test
    fun `VPN alone cannot be selected as local network`() {
        assertSame(base, lanClient(context, base, "10.8.0.10"))
    }

    @Test
    fun `reconnect rechecks available networks after wifi is lost`() {
        addNetwork(101, NetworkCapabilities.TRANSPORT_WIFI, "192.168.1.2/24")
        assertNotSame(base, lanClient(context, base, "192.168.1.50"))
        shadowOf(manager).clearAllNetworks()
        assertSame(base, lanClient(context, base, "192.168.1.50"))
    }

    @Test
    fun `wifi routing also works before VPN is enabled`() {
        shadowOf(manager).clearAllNetworks()
        addNetwork(101, NetworkCapabilities.TRANSPORT_WIFI, "192.168.1.2/24")
        assertSame(wifiSocketFactory, lanClient(context, base, "192.168.1.50").socketFactory)
    }
}
