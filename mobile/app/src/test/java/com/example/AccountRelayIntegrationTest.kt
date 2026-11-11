package com.example

import android.util.Base64
import com.example.account.AccountIdentity
import com.example.account.AccountRelayBridge
import com.example.network.buildTofuTlsClient
import java.io.File
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class AccountRelayIntegrationTest {
    @Test(timeout = 55000)
    fun androidAndNodeExchangeTlsTrafficAndRejectWrongPcCertificate() = runBlocking {
        val fixture = generateSequence(File(System.getProperty("user.dir"))) { it.parentFile }
            .map { File(it, "aether-remote-host-agent/test/account_android_relay_fixture.cjs") }
            .firstOrNull { it.isFile } ?: error("Sibling Windows host is required for the cross-platform relay test")
        val process = ProcessBuilder("node", fixture.absolutePath).directory(fixture.parentFile.parentFile).start()
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val spki = Base64.encodeToString(pair.public.encoded, Base64.NO_WRAP)
        val identity = AccountIdentity::class.java.getDeclaredConstructor(String::class.java, PrivateKey::class.java)
            .apply { isAccessible = true }.newInstance(spki, pair.private)
        val owner = UUID.randomUUID().toString()
        val session = UUID.randomUUID().toString()
        var bridge: AccountRelayBridge? = null
        var socket: WebSocket? = null
        val base = OkHttpClient.Builder().callTimeout(15, TimeUnit.SECONDS).build()
        try {
            process.outputStream.bufferedWriter().apply {
                write(JSONObject().put("ownerId", owner).put("sessionId", session).put("deviceId", identity.id)
                    .put("publicKeySpki", spki).toString() + "\n")
                flush()
            }
            val config = JSONObject(CompletableFuture.supplyAsync { process.inputStream.bufferedReader().readLine() }
                .get(15, TimeUnit.SECONDS))
            val pin = config.getString("fingerprint")
            val outer = buildTofuTlsClient(base, pin, {}, allowRelayLoopback = true)
            suspend fun connect() = AccountRelayBridge.open(outer, "wss://127.0.0.1:${config.getInt("port")}",
                owner, session, identity, "integration-test-token")
            bridge = connect()
            val opened = CompletableFuture<Unit>()
            val reply = CompletableFuture<ByteString>()
            val client = buildTofuTlsClient(base, pin, {}, allowRelayLoopback = true)
            socket = client.newWebSocket(Request.Builder().url("wss://127.0.0.1:${bridge.port}/account-relay/$session").build(),
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) { opened.complete(Unit) }
                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) { reply.complete(bytes) }
                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        opened.completeExceptionally(t); reply.completeExceptionally(t)
                    }
                })
            opened.get(15, TimeUnit.SECONDS)
            val bytes = ByteArray(1024 * 1024).also { java.security.SecureRandom().nextBytes(it) }.toByteString()
            assertTrue(socket.send(bytes))
            assertEquals(bytes, reply.get(15, TimeUnit.SECONDS))
            socket.cancel()
            bridge.close()
            bridge = connect()
            val rejected = CompletableFuture<Throwable>()
            val wrongPin = buildTofuTlsClient(base, "b".repeat(64), {}, allowRelayLoopback = true)
            socket = wrongPin.newWebSocket(Request.Builder().url("wss://127.0.0.1:${bridge.port}/account-relay/$session").build(),
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        rejected.completeExceptionally(AssertionError("Incorrect PC certificate accepted"))
                    }
                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { rejected.complete(t) }
                })
            val failure = rejected.get(15, TimeUnit.SECONDS)
            assertTrue(generateSequence(failure) { it.cause }.any { it is java.security.cert.CertificateException })
        } finally {
            socket?.cancel()
            bridge?.close()
            base.dispatcher.cancelAll()
            base.connectionPool.evictAll()
            base.dispatcher.executorService.shutdown()
            process.destroyForcibly()
            process.waitFor(5, TimeUnit.SECONDS)
        }
    }
}
