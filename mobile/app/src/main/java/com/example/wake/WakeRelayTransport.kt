package com.example.wake

import android.util.Base64
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import kotlin.coroutines.resume

interface WakeSocket {
    fun send(text: String)
    fun close()
}

interface WakeSocketListener {
    fun onOpen()
    fun onMessage(text: String)
    fun onFailure(code: String)
}

fun interface WakeSocketFactory {
    fun open(url: String, listener: WakeSocketListener): WakeSocket
}

class OkHttpWakeSocketFactory(private val client: OkHttpClient) : WakeSocketFactory {
    override fun open(url: String, listener: WakeSocketListener): WakeSocket {
        val socket = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = listener.onOpen()
            override fun onMessage(webSocket: WebSocket, text: String) = listener.onMessage(text)
            override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) = listener.onFailure("relay_unavailable")
        })
        return object : WakeSocket {
            override fun send(text: String) { socket.send(text) }
            override fun close() { socket.close(1000, "wake_complete") }
        }
    }
}

class WakeRelayTransport(private val socketFactory: WakeSocketFactory) : WakeRemoteTransport {
    override suspend fun wake(enrollment: WakeEnrollment, request: WakeRequest, onEvent: (WakeRemoteEvent) -> Unit) {
        if (!isAllowedWakeRelayUrl(enrollment.relayUrl)) {
            onEvent(WakeRemoteEvent.Failed("invalid_relay_url"))
            return
        }
        withTimeout(120_000) {
            suspendCancellableCoroutine { continuation ->
                lateinit var socket: WakeSocket
                val requestJson = JSONObject().apply {
                    put("version", request.version); put("type", request.type); put("groupId", request.groupId)
                    put("targetDeviceId", request.targetDeviceId); put("senderDeviceId", request.senderDeviceId)
                    put("nonce", request.nonce); put("issuedAt", request.issuedAt); put("expiresAt", request.expiresAt)
                    put("signature", request.signature)
                }.toString()
                val certificate = Base64.encodeToString(enrollment.certificateJson.toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                val relayUri = java.net.URI(enrollment.relayUrl)
                val scheme = if (relayUri.scheme.equals("https", ignoreCase = true)) "wss://" else "ws://"
                val base = enrollment.relayUrl.substringAfter("://").trimEnd('/')
                val member = JSONObject(enrollment.certificateJson).getString("deviceId")
                val url = "$scheme$base/v1/groups/${enrollment.groupId}/socket?deviceId=$member&certificate=$certificate"
                socket = socketFactory.open(url, object : WakeSocketListener {
                    override fun onOpen() = socket.send(requestJson)
                    override fun onMessage(text: String) {
                        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                        when {
                            json.optString("type") == "wake.delivery" && json.optString("nonce") == request.nonce && json.optString("status") == "delivered" -> onEvent(WakeRemoteEvent.Delivered)
                            json.optString("type") == "wake.delivery" && json.optString("nonce") == request.nonce -> {
                                onEvent(WakeRemoteEvent.Failed(json.optString("code", "bridge_rejected"))); socket.close(); if (continuation.isActive) continuation.resume(Unit)
                            }
                            json.optString("type") == "host.online" && json.optString("deviceId") == enrollment.targetDeviceId -> {
                                onEvent(WakeRemoteEvent.Online); socket.close(); if (continuation.isActive) continuation.resume(Unit)
                            }
                            json.optString("type") == "error" && json.optString("nonce") == request.nonce -> {
                                onEvent(WakeRemoteEvent.Failed(json.optString("code", "relay_error"))); socket.close(); if (continuation.isActive) continuation.resume(Unit)
                            }
                        }
                    }
                    override fun onFailure(code: String) {
                        onEvent(WakeRemoteEvent.Failed(code)); if (continuation.isActive) continuation.resume(Unit)
                    }
                })
                continuation.invokeOnCancellation { socket.close() }
            }
        }
    }
}
