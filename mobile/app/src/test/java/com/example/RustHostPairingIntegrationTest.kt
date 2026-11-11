package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.data.AetherPreferences
import com.example.model.ConnectionStatus
import com.example.network.PcWebSocketManager
import com.example.network.TlsPinStore
import com.example.network.buildTofuTlsClient
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.security.cert.CertificateException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RustHostPairingIntegrationTest {
    @Test(timeout = 90000)
    fun androidPairsAndDiscoversLiveRustHostAcrossDelayedApprovalAndPinsTls(): Unit = runBlocking {
        val startDir = File(System.getProperty("user.dir") ?: ".")
        val hostRoot = generateSequence(startDir) { it.parentFile }
            .map { File(it, "aether-remote-host-agent") }
            .firstOrNull { File(it, "crates/aether-host-server/examples/android_pairing_fixture.rs").isFile }
            ?: error("Sibling aether-remote-host-agent directory is required for Rust integration test")

        val exeCandidate = File(hostRoot, "target/debug/examples/android_pairing_fixture.exe")
        val binCandidate = File(hostRoot, "target/debug/examples/android_pairing_fixture")
        val command = when {
            exeCandidate.isFile -> listOf(exeCandidate.absolutePath)
            binCandidate.isFile -> listOf(binCandidate.absolutePath)
            else -> listOf(
                "cargo",
                "run",
                "--offline",
                "--quiet",
                "--package",
                "aether-host-server",
                "--example",
                "android_pairing_fixture"
            )
        }

        val process = ProcessBuilder(command).directory(hostRoot).start()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val baseHttp = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
        val manager = PcWebSocketManager(context)
        val udpClient = DatagramSocket()

        try {
            val pin12 = "000001654321"
            process.outputStream.bufferedWriter().apply {
                write(
                    JSONObject()
                        .put("pin12", pin12)
                        .put("approvalDelayMs", 9500)
                        .put("trusted", true)
                        .toString() + "\n"
                )
                flush()
            }

            val configLine = CompletableFuture.supplyAsync {
                process.inputStream.bufferedReader().readLine()
            }.get(30, TimeUnit.SECONDS) ?: error("Rust fixture did not emit config JSON")
            val config = JSONObject(configLine)
            val port = config.getInt("port")
            val udpPort = config.getInt("udpPort")
            val fingerprint = config.getString("fingerprint")
            assertTrue("Fixture cert must be valid", config.getBoolean("certValid"))

            // 1. UDP discovery replies to AETHER_DISCOVER and never echoes beacons back into a loop
            udpClient.soTimeout = 300
            val beaconNoise = """{"service":"aether-remote","ip":"127.0.0.1","port":$port}""".toByteArray()
            udpClient.send(DatagramPacket(beaconNoise, beaconNoise.size, InetAddress.getByName("127.0.0.1"), udpPort))
            val echoRecv = runCatching {
                val buf = ByteArray(1024)
                udpClient.receive(DatagramPacket(buf, buf.size))
            }
            assertTrue(
                "Discovery socket must ignore JSON beacon packets",
                echoRecv.exceptionOrNull() is SocketTimeoutException
            )

            udpClient.soTimeout = 2000
            val probe = "AETHER_DISCOVER".toByteArray()
            udpClient.send(DatagramPacket(probe, probe.size, InetAddress.getByName("127.0.0.1"), udpPort))
            val recvBuf = ByteArray(1024)
            val packet = DatagramPacket(recvBuf, recvBuf.size)
            udpClient.receive(packet)
            val beaconJson = JSONObject(String(packet.data, 0, packet.length, Charsets.UTF_8))
            assertEquals("aether-remote", beaconJson.getString("service"))
            assertEquals(port, beaconJson.getInt("port"))
            assertEquals(fingerprint, beaconJson.getString("tlsFingerprint"))

            // 2. HTTPS /health succeeds with TOFU and rejects mismatched pin
            val verifiedFp = AtomicReference<String?>(null)
            val tofuHttp = buildTofuTlsClient(baseHttp, null, verifiedFp::set, allowUnpinnedDiscovery = true)
            tofuHttp.newCall(Request.Builder().url("https://127.0.0.1:$port/health").get().build()).execute().use { resp ->
                assertTrue(resp.isSuccessful)
                val body = JSONObject(resp.body?.string().orEmpty())
                assertEquals("ok", body.getString("status"))
                assertEquals("2.0", body.getString("protocolVersion"))
            }
            assertEquals(fingerprint, verifiedFp.get())

            val wrongFingerprint = "SHA256:${"FF".repeat(32)}"
            val wrongHttp = buildTofuTlsClient(baseHttp, wrongFingerprint, {}, allowUnpinnedDiscovery = false)
            val mismatchError = runCatching {
                wrongHttp.newCall(Request.Builder().url("https://127.0.0.1:$port/health").get().build()).execute()
            }.exceptionOrNull()
            assertNotNull(mismatchError)
            assertTrue(generateSequence(mismatchError) { it.cause }.any { it is CertificateException })

            // 3. Mismatched QR / pinned TLS cert triggers clear rejection feedback in PcWebSocketManager
            TlsPinStore(context).remove("127.0.0.1", port)
            manager.connect("127.0.0.1", port, pin12, false, wrongFingerprint)
            withTimeout(6000) {
                manager.actionFeedback.first { it != null && it.contains("Сертификат ПК изменился") }
            }
            assertEquals(ConnectionStatus.DISCONNECTED, manager.connectionStatus.value)
            manager.disconnect()

            // 4. Real 12-digit PIN pairing survives > 8s AUTH_PENDING wait and persists pin + saved_pcs
            TlsPinStore(context).remove("127.0.0.1", port)
            manager.connect("127.0.0.1", port, pin12, false, null)
            withTimeout(6000) {
                manager.connectionStatus.first { it == ConnectionStatus.AWAITING_APPROVAL }
            }
            withTimeout(20000) {
                manager.connectionStatus.first { it == ConnectionStatus.CONNECTED }
            }
            assertEquals(fingerprint, TlsPinStore(context).get("127.0.0.1", port))
            delay(300)
            val savedRaw = AetherPreferences.secure(context).getString("saved_pcs", "[]") ?: "[]"
            val savedArr = JSONArray(savedRaw)
            assertFalse("saved_pcs must be populated after PIN pairing", savedArr.length() == 0)
            assertEquals("127.0.0.1", savedArr.getJSONObject(0).getString("hostIp"))
            assertEquals(port, savedArr.getJSONObject(0).getInt("hostPort"))
            assertEquals(fingerprint, savedArr.getJSONObject(0).getString("tlsFingerprint"))
        } finally {
            manager.disconnect()
            udpClient.close()
            baseHttp.dispatcher.cancelAll()
            baseHttp.connectionPool.evictAll()
            baseHttp.dispatcher.executorService.shutdown()
            runCatching {
                process.outputStream.bufferedWriter().apply {
                    write("EXIT\n")
                    flush()
                }
            }
            process.destroyForcibly()
            process.waitFor(5, TimeUnit.SECONDS)
        }
    }
}
