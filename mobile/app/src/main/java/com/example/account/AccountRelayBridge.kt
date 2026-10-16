package com.example.account

import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.security.PrivateKey
import java.security.Signature
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject

/** A single local TCP connection carrying the existing phone-to-PC TLS stream. */
class AccountRelayBridge private constructor(private val onClosed: () -> Unit) : AutoCloseable {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val closed = AtomicBoolean(false)
    private val ready = CompletableDeferred<Unit>()
    private val incoming = Channel<ByteArray>(8)
    private val credit = Channel<Unit>(Channel.CONFLATED)
    private val lock = Any()
    private var sent = 0L
    private var acknowledged = 0L
    private var received = 0L
    private var acknowledgedReceive = 0L
    @Volatile private var carrier: WebSocket? = null
    private var listener: ServerSocket? = null
    private var local: Socket? = null
    var port: Int = 0
        private set

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        ready.completeExceptionally(IllegalStateException("relay_closed"))
        synchronized(lock) {
            runCatching { listener?.close() }
            runCatching { local?.close() }
        }
        carrier?.cancel()
        incoming.close()
        credit.close()
        scope.cancel()
        runCatching(onClosed)
    }

    private fun receive(bytes: ByteArray) {
        require(bytes.size in 5..MAX_FRAME)
        val offset = ByteBuffer.wrap(bytes, 1, 4).int.toLong() and 0xffffffffL
        synchronized(lock) {
            when (bytes[0].toInt()) {
                0 -> {
                    require(bytes.size > 5 && offset == received)
                    received += bytes.size - 5
                    require(received <= 0xffffffffL && received - acknowledgedReceive <= WINDOW)
                    require(incoming.trySend(bytes.copyOfRange(5, bytes.size)).isSuccess)
                }
                1 -> {
                    require(bytes.size == 5 && offset in acknowledged..sent)
                    acknowledged = offset
                    credit.trySend(Unit)
                }
                else -> error("invalid_relay_frame")
            }
        }
    }

    private fun startLocal() {
        synchronized(lock) {
            check(!closed.get())
            listener = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).apply { soTimeout = 15000 }
            port = checkNotNull(listener).localPort
        }
        scope.launch {
            try {
                val socket = checkNotNull(listener).accept()
                local = socket
                listener?.close()
                if (closed.get()) { socket.close(); return@launch }
                socket.tcpNoDelay = true
                launch {
                    try {
                        val output = socket.getOutputStream()
                        for (bytes in incoming) {
                            output.write(bytes)
                            val acknowledgement = synchronized(lock) {
                                acknowledgedReceive += bytes.size
                                frame(1, acknowledgedReceive)
                            }
                            check(carrier?.send(acknowledgement) == true)
                        }
                    } catch (_: Exception) { close() }
                }
                val input = socket.getInputStream()
                val buffer = ByteArray(MAX_FRAME - 5)
                while (!closed.get()) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    var position = 0
                    while (position < count) {
                        val data = synchronized(lock) {
                            val available = minOf(count - position, (WINDOW - sent + acknowledged).toInt())
                            if (available > 0) {
                                check(sent + available <= 0xffffffffL)
                                val frame = ByteBuffer.allocate(available + 5).put(0).putInt(sent.toInt())
                                    .put(buffer, position, available).array()
                                check((carrier?.queueSize() ?: Long.MAX_VALUE) + frame.size <= MAX_QUEUE)
                                sent += available
                                frame
                            } else {
                                null
                            }
                        }
                        if (data == null) {
                            credit.receive()
                        } else {
                            check(carrier?.send(data.toByteString()) == true)
                            position += data.size - 5
                        }
                    }
                }
            } catch (_: Exception) { /* Closing sockets interrupts blocking IO. */ }
            finally { close() }
        }
    }

    companion object {
        private const val MAX_FRAME = 256 * 1024
        private const val WINDOW = 1024 * 1024L
        private const val MAX_QUEUE = 2 * 1024 * 1024L
        private fun frame(type: Int, offset: Long): ByteString = ByteBuffer.allocate(5)
            .put(type.toByte()).putInt(offset.toInt()).array().toByteString()

        internal fun joinProof(json: JSONObject, ownerId: String, sessionId: String,
            deviceId: String, privateKey: PrivateKey, now: Long = System.currentTimeMillis()): String {
            require(json.accountString("ownerId") == ownerId && json.accountString("sessionId") == sessionId &&
                json.accountString("deviceId") == deviceId && json.accountString("role") == "phone")
            val nonce = json.accountString("nonce")
            val expiry = json.accountLong("expiresAt")
            require(Regex("^[A-Za-z0-9_-]{43}$").matches(nonce) && expiry > now && expiry <= now + 30000)
            val canonical = listOf("AETHER_RELAY_JOIN_V1", ownerId, sessionId, "phone", deviceId, nonce, expiry)
                .joinToString("\n").toByteArray(Charsets.UTF_8)
            val signature = Signature.getInstance("SHA256withECDSA").run {
                initSign(privateKey)
                update(canonical)
                sign()
            }
            return JSONObject().put("type", "proof").put("signature", AccountProtocol.base64Url(signature)).toString()
        }

        suspend fun open(client: OkHttpClient, url: String, ownerId: String, sessionId: String,
            identity: AccountIdentity, token: String, onClosed: () -> Unit = {}): AccountRelayBridge = withContext(Dispatchers.IO) {
            val endpoint = url.replaceFirst("wss://", "https://").toHttpUrl()
            require(url.startsWith("wss://") && endpoint.username.isEmpty() && endpoint.password.isEmpty() &&
                endpoint.query == null && endpoint.fragment == null)
            require(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(sessionId))
            val bridge = AccountRelayBridge(onClosed)
            try {
                val request = Request.Builder().url(endpoint.newBuilder()
                    .encodedPath("/v1/connect/$sessionId/phone").build())
                    .header("Authorization", "Bearer $token").build()
                bridge.carrier = client.newBuilder().followRedirects(false).followSslRedirects(false).build()
                    .newWebSocket(request, object : WebSocketListener() {
                        private var signed = false
                        private var active = false
                        override fun onMessage(webSocket: WebSocket, text: String) {
                            try {
                                require(text.length <= 2048 && !active)
                                val json = JSONObject(text)
                                when (json.accountString("type")) {
                                    "challenge" -> {
                                        require(!signed)
                                        val proof = joinProof(json, ownerId, sessionId, identity.id, identity.privateKey)
                                        signed = true
                                        check(webSocket.send(proof))
                                    }
                                    "ready" -> {
                                        require(signed && json.accountLong("expiresAt") > System.currentTimeMillis())
                                        active = true
                                        bridge.ready.complete(Unit)
                                    }
                                    else -> error("invalid_relay_message")
                                }
                            } catch (_: Exception) { bridge.close() }
                        }
                        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                            try { require(active && bytes.size in 5..MAX_FRAME); bridge.receive(bytes.toByteArray()) }
                            catch (_: Exception) { bridge.close() }
                        }
                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { bridge.close() }
                        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { bridge.close() }
                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { bridge.close() }
                    })
                withTimeout(20000) { bridge.ready.await() }
                check(!bridge.closed.get())
                bridge.startLocal()
                bridge
            } catch (error: Exception) { bridge.close(); throw error }
        }
    }
}
