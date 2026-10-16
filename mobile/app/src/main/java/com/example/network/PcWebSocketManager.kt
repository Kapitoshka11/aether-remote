package com.example.network

import com.example.account.AccountConnection
import com.example.account.AccountChallenge
import com.example.account.AccountGrant
import com.example.account.AccountProtocol
import com.example.account.accountEndpointCandidates

import android.content.Context
import android.content.ContentValues
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.OutputStream
import android.speech.tts.TextToSpeech
import android.util.Base64
import android.widget.Toast
import com.example.model.ClipboardData
import com.example.model.ConnectionState
import com.example.model.ConnectionStatus
import com.example.model.FileTransferProgress
import com.example.model.HostConfig
import com.example.model.HostPlatform
import com.example.model.IncomingFileOffer
import com.example.model.MediaState
import com.example.model.ReceivedFile
import com.example.model.SystemStats
import com.example.aetherdeck.DeckAssetCache
import com.example.aetherdeck.DeckStore
import com.example.data.ClipboardHistoryRepository
import com.example.data.AetherPreferences
import com.example.wake.WakeEnrollment
import com.example.wake.WakeEnrollmentStore
import com.example.wake.WakeIdentityLoadResult
import com.example.wake.WakeIdentityStore
import com.example.wake.OkHttpWakeSocketFactory
import com.example.wake.WakeCoordinator
import com.example.wake.WakeRelayTransport
import com.example.wake.WakeStage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import org.json.JSONArray
import java.net.NetworkInterface
import java.util.Collections
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import java.security.cert.CertificateException
import javax.net.ssl.SSLPeerUnverifiedException

private const val MAX_INBOUND_TEXT_CHARS = 12 * 1024 * 1024
private const val MAX_INBOUND_VIDEO_BYTES = 8 * 1024 * 1024
private const val MAX_INBOUND_AUDIO_BYTES = 256 * 1024
private const val MAX_BASE64_CHUNK_CHARS = 350 * 1024
private const val MAX_DECODED_IMAGE_DIMENSION = 4096
private const val MAX_DECODED_IMAGE_PIXELS = 16 * 1024 * 1024
private const val MAX_TRANSFER_FILE_BYTES = 500L * 1024L * 1024L
private const val DIRECT_ROUTE_TIMEOUT_MS = 1_500L

internal fun buildReconnectNetworkRequest(): NetworkRequest = NetworkRequest.Builder()
    .removeCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
    .build()

internal fun isInboundTextWithinLimit(text: String): Boolean = text.length <= MAX_INBOUND_TEXT_CHARS

internal fun hasSafeJsonNesting(text: String, maximumDepth: Int = 64): Boolean {
    if (maximumDepth <= 0) return false
    val delimiters = CharArray(maximumDepth)
    var depth = 0
    var inString = false
    var escaped = false
    for (character in text) {
        if (inString) {
            if (escaped) escaped = false
            else if (character == '\\') escaped = true
            else if (character == '"') inString = false
            continue
        }
        when (character) {
            '"' -> inString = true
            '{', '[' -> {
                if (depth >= maximumDepth) return false
                delimiters[depth++] = character
            }
            '}', ']' -> {
                if (depth == 0) return false
                val expectedOpening = if (character == '}') '{' else '['
                if (delimiters[--depth] != expectedOpening) return false
            }
        }
    }
    return depth == 0 && !inString
}

internal fun validateIncomingFileOffer(fileId: String, fileName: String, fileSize: Long): IncomingFileOffer? {
    if (fileId.isBlank() || fileId.length > 128 || fileName.length > 255 || fileSize !in 0..MAX_TRANSFER_FILE_BYTES) return null
    return IncomingFileOffer(fileId, sanitizeIncomingFileName(fileName), fileSize)
}

internal enum class IncomingFileChunkDecision { ACCEPT, REJECT_CHUNK, ABORT_TRANSFER }

internal fun incomingFileChunkDecision(
    fileId: String,
    activeFileId: String?,
    offset: Long,
    expectedOffset: Long,
    encodedChunk: String
): IncomingFileChunkDecision = when {
    fileId != activeFileId -> IncomingFileChunkDecision.REJECT_CHUNK
    offset != expectedOffset || encodedChunk.isEmpty() -> IncomingFileChunkDecision.ABORT_TRANSFER
    else -> IncomingFileChunkDecision.ACCEPT
}

internal fun sanitizeIncomingFileName(fileName: String, fallbackTimestamp: Long = System.currentTimeMillis()): String {
    val leafName = File(fileName.replace('\\', '/')).name
    val sanitized = leafName
        .replace(Regex("[\\u0000-\\u001F<>:\"/\\\\|?*]"), "_")
        .trimEnd('.', ' ')
    return sanitized.takeUnless { it.isBlank() || it == "." || it == ".." }
        ?: "downloaded_$fallbackTimestamp.bin"
}

internal fun isAudioStreamActive(enabled: Boolean, status: String): Boolean = enabled && status != "ERROR"

internal enum class ClipboardMessageKind { PC_CONTENT, WRITE_ACK, OTHER }

internal fun clipboardMessageKind(action: String, type: String): ClipboardMessageKind = when {
    action in setOf("CLIPBOARD_WRITE_ACK", "CLIPBOARD_RESPONSE", "CLIPBOARD_OK") || type == "CLIPBOARD_RESPONSE" ->
        ClipboardMessageKind.WRITE_ACK
    action in setOf("CLIPBOARD", "CLIPBOARD_TEXT", "CLIPBOARD_ITEM") -> ClipboardMessageKind.PC_CONTENT
    else -> ClipboardMessageKind.OTHER
}

class PcWebSocketManager(context: Context) {

    private val context = context.applicationContext

    private val parentJob = kotlinx.coroutines.SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + parentJob)
    private val clipboardHistoryRepository = ClipboardHistoryRepository(context)
    val clipboardHistory = clipboardHistoryRepository.items.stateIn(scope, SharingStarted.Eagerly, emptyList())
    private val tlsPinStore = TlsPinStore(context)

    private val _connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    private val _authenticatedPeerIdentity = MutableStateFlow<String?>(null)
    val authenticatedPeerIdentity: StateFlow<String?> = _authenticatedPeerIdentity.asStateFlow()

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val deckAssetCache = DeckAssetCache(context)
    private val failedDeckAssets = ConcurrentHashMap.newKeySet<String>()
    private val _deckAssetRevision = MutableStateFlow(0L)
    val deckAssetRevision: StateFlow<Long> = _deckAssetRevision.asStateFlow()
    val deckStore = DeckStore { payload -> webSocket?.send(payload) }
    val deckState = deckStore.state
    fun getDeckAsset(hash: String): Pair<String, ByteArray>? = deckAssetCache.read(hash)?.let { (deckAssetCache.mimeType(hash) ?: "application/octet-stream") to it }
    fun requestDeckAsset(hash: String) {
        if (!deckAssetCache.contains(hash) && hash !in failedDeckAssets) deckStore.requestAsset(hash)
    }

    private val _hostConfig = MutableStateFlow(HostConfig())
    val hostConfig: StateFlow<HostConfig> = _hostConfig.asStateFlow()

    private val _systemStats = MutableStateFlow(SystemStats())
    val systemStats: StateFlow<SystemStats> = _systemStats.asStateFlow()

    private val _mediaState = MutableStateFlow(MediaState())
    val mediaState: StateFlow<MediaState> = _mediaState.asStateFlow()

    private val _clipboardData = MutableStateFlow(ClipboardData())
    val clipboardData: StateFlow<ClipboardData> = _clipboardData.asStateFlow()

    private val _latestScreenshotBitmap = MutableStateFlow<Bitmap?>(null)
    val latestScreenshotBitmap: StateFlow<Bitmap?> = _latestScreenshotBitmap.asStateFlow()

    private val _isCapturingScreenshot = MutableStateFlow(false)
    val isCapturingScreenshot: StateFlow<Boolean> = _isCapturingScreenshot.asStateFlow()

    private val _isLiveStreaming = MutableStateFlow(false)
    val isLiveStreaming: StateFlow<Boolean> = _isLiveStreaming.asStateFlow()

    private val _actionFeedback = MutableStateFlow<String?>(null)
    val actionFeedback: StateFlow<String?> = _actionFeedback.asStateFlow()
    private val _adminConfirmCommand = MutableStateFlow<String?>(null)
    val adminConfirmCommand: StateFlow<String?> = _adminConfirmCommand.asStateFlow()

    fun clearAdminConfirm() {
        _adminConfirmCommand.value = null
    }

    fun confirmAdminCommand(command: String) {
        val json = JSONObject().apply {
            put("action", "POWERSHELL")
            put("command", command)
            put("force", true)
            put("confirm", true)
        }
        webSocket?.send(json.toString())
        _adminConfirmCommand.value = null
    }

    private val _isAudioStreamEnabled = MutableStateFlow(false)
    val isAudioStreamEnabled: StateFlow<Boolean> = _isAudioStreamEnabled.asStateFlow()

    private val _fileTransferProgress = MutableStateFlow<FileTransferProgress?>(null)
    val fileTransferProgress: StateFlow<FileTransferProgress?> = _fileTransferProgress.asStateFlow()

    private val _receivedFiles = MutableStateFlow<List<ReceivedFile>>(emptyList())
    val receivedFiles: StateFlow<List<ReceivedFile>> = _receivedFiles.asStateFlow()
    private val _incomingFileOffer = MutableStateFlow<IncomingFileOffer?>(null)
    val incomingFileOffer: StateFlow<IncomingFileOffer?> = _incomingFileOffer.asStateFlow()
    private var incomingFileOfferTimeoutJob: Job? = null

    private val _latencyMs = MutableStateFlow<Long?>(null)
    val latencyMs: StateFlow<Long?> = _latencyMs.asStateFlow()

    private val _isTelemetryStale = MutableStateFlow(false)
    val isTelemetryStale: StateFlow<Boolean> = _isTelemetryStale.asStateFlow()

    private var lastTelemetryTimestamp: Long = 0L

    data class ConnectionLog(
        val id: String,
        val time: String,
        val target: String,
        val transport: String,
        val step: String,
        val status: String,
        val errorDetail: String? = null
    )

    private val _connectionLogs = MutableStateFlow<List<ConnectionLog>>(emptyList())
    val connectionLogs: StateFlow<List<ConnectionLog>> = _connectionLogs.asStateFlow()

    fun addConnectionLog(target: String, transport: String, step: String, status: String, errorDetail: String? = null) {
        val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.getDefault())
        val time = sdf.format(java.util.Date())
        val newLog = ConnectionLog(
            id = java.util.UUID.randomUUID().toString(),
            time = time,
            target = target,
            transport = transport,
            step = step,
            status = status,
            errorDetail = errorDetail
        )
        _connectionLogs.value = (listOf(newLog) + _connectionLogs.value).take(50)
    }

    fun clearConnectionLogs() {
        _connectionLogs.value = emptyList()
    }

    private val sharedOkHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build()
    }
    private var webSocket: WebSocket? = null
    private var liveStreamJob: Job? = null
    private var pingJob: Job? = null
    private val reconnectScheduler = ReconnectScheduler(scope)
    private var connectionGeneration = 0L
    private data class ConnectionAttemptState(val key: Any, val authenticated: Boolean)
    private val activeConnectionAttempt = AtomicReference<ConnectionAttemptState?>(null)

    private var reconnectAttempts = 0
    private var isManualDisconnect = false
    private var secureStorageAvailable = true
    private val wakeIdentityStore by lazy { WakeIdentityStore(getSecureSharedPreferences()) }
    private val wakeEnrollmentStore by lazy { WakeEnrollmentStore(getSecureSharedPreferences()) }
    private var pendingWakeTargetDeviceId = ""

    private val pendingFileStartAcks = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val pendingFileChunkAcks = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val pendingFileEndAcks = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()

    private val audioTrack = AtomicReference<AudioTrack?>(null)
    private val audioPlaybackEnabled = AtomicBoolean(false)
    private val audioTrackLock = Any()
    private val audioReleaseJob = kotlinx.coroutines.SupervisorJob()
    private val audioReleaseScope = CoroutineScope(Dispatchers.IO + audioReleaseJob)
    private data class AudioChunk(val generation: Long, val bytes: ByteArray)
    private val audioGeneration = AtomicLong(0L)
    private val audioChunks = Channel<AudioChunk>(capacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    private val videoFrames = Channel<ByteArray>(capacity = 1)
    private val pendingFrameId = AtomicLong(-1L)

    private val incomingFileLock = Any()
    private var currentFileOutputStream: OutputStream? = null
    private var currentFileTarget: File? = null
    private var currentFileUri: Uri? = null
    private var currentIncomingFileId: String? = null
    private var currentIncomingExpectedSize = 0L
    private var currentIncomingReceivedSize = 0L
    private var screenshotTimeoutJob: Job? = null
    private val streamLifecyclePolicy = StreamLifecyclePolicy()

    private var ttsEngine: TextToSpeech? = null
    private var isTtsReady = false

    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        scope.launch {
            for (bytes in videoFrames) decodeBinaryFrame(bytes)
        }
        scope.launch {
            for (chunk in audioChunks) writeAudioChunk(chunk)
        }
    }

    init {
        initTts()
        registerNetworkCallback()
        scope.launch {
            clipboardHistoryRepository.purgeLegacySensitiveEntries()
            clipboardHistoryRepository.cleanUpDuplicates()
        }
    }

    private fun initTts() {
        ttsEngine = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val result = ttsEngine?.setLanguage(Locale("ru", "RU"))
                isTtsReady = (result != TextToSpeech.LANG_MISSING_DATA && result != TextToSpeech.LANG_NOT_SUPPORTED)
                if (!isTtsReady) {
                    ttsEngine?.setLanguage(Locale.US)
                    isTtsReady = true
                }
            }
        }
    }

    fun destroy() {
        _isAudioStreamEnabled.value = false
        val trackToRelease = synchronized(audioTrackLock) {
            audioPlaybackEnabled.set(false)
            audioTrack.getAndSet(null)
        }
        try { trackToRelease?.stop() } catch (_: Exception) {}
        try { trackToRelease?.release() } catch (_: Exception) {}
        screenshotTimeoutJob?.cancel()

        try {
            currentFileOutputStream?.close()
            currentFileOutputStream = null
        } catch (_: Exception) {}

        try {
            sharedOkHttpClient.connectionPool.evictAll()
        } catch (_: Exception) {}

        try {
            ttsEngine?.stop()
            ttsEngine?.shutdown()
            ttsEngine = null
        } catch (_: Exception) {}

        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            networkCallback?.let { cm?.unregisterNetworkCallback(it) }
        } catch (_: Exception) {}

        try {
            parentJob.cancel()
        } catch (_: Exception) {}
        audioReleaseJob.cancel()

        disconnect()
    }

    private fun registerNetworkCallback() {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val request = buildReconnectNetworkRequest()

        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (_connectionStatus.value == ConnectionStatus.DISCONNECTED && !isManualDisconnect &&
                    (accountConnection != null || _hostConfig.value.ip.isNotEmpty())) {
                    scope.launch {
                        delay(500)
                        triggerReconnect(_hostConfig.value.ip, _hostConfig.value.port, _hostConfig.value.token)
                    }
                }
            }
        }
        try {
            cm.registerNetworkCallback(request, networkCallback!!)
        } catch (_: Exception) {}
    }

    private fun getActiveDeviceSubnetPrefix(): String {
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val dhcpInfo = wifiManager?.dhcpInfo
            if (dhcpInfo != null && dhcpInfo.ipAddress != 0) {
                val ip = dhcpInfo.ipAddress
                val ipStr = String.format(
                    Locale.US, "%d.%d.",
                    ip and 0xff,
                    ip shr 8 and 0xff
                )
                return ipStr
            }

            val interfaces = Collections.list(NetworkInterface.getNetworkInterfaces())
            for (intf in interfaces) {
                if (intf.isUp && !intf.isLoopback) {
                    val addrs = Collections.list(intf.inetAddresses)
                    for (addr in addrs) {
                        if (!addr.isLoopbackAddress) {
                            val hostAddress = addr.hostAddress ?: continue
                            if (hostAddress.indexOf(':') < 0) {
                                val parts = hostAddress.split(".")
                                if (parts.size == 4) {
                                    return "${parts[0]}.${parts[1]}."
                                }
                            }
                        }
                    }
                }
            }
        } catch (_: Exception) {}
        return "192.168."
    }

    private fun getSecureSharedPreferences(): android.content.SharedPreferences {
        val result = AetherPreferences.secureWithStatus(context)
        secureStorageAvailable = result.persistent
        return result.preferences
    }

    @Volatile private var accountConnection: AccountConnection? = null
    private var accountRouteJob: Job? = null
    private val _accountApprovalCode = MutableStateFlow<String?>(null)
    val accountApprovalCode = _accountApprovalCode.asStateFlow()
    val accountOwnerId: String? get() = accountConnection?.host?.ownerId
    val accountHostDeviceId: String? get() = accountConnection?.host?.id
    val accountPhoneDeviceId: String? get() = accountConnection?.identity?.id

    fun connectAccount(connection: AccountConnection) {
        disconnect()
        require(connection.host.kind == "host" && !connection.host.revoked && connection.host.tlsFingerprint != null)
        connection.grant?.let {
            require(AccountProtocol.verifyGrant(it, connection.host.publicKeySpki) &&
                it.ownerId == connection.host.ownerId && it.phoneId == connection.identity.id &&
                it.hostId == connection.host.id && it.hostTlsFingerprint == connection.host.tlsFingerprint)
        }
        accountConnection = connection
        isManualDisconnect = false
        startAccountConnection(connection)
    }

    private fun startAccountConnection(connection: AccountConnection) {
        if (connection.bridge != null) {
            performConnect("127.0.0.1", connection.bridge.port, "", false, false, connection.host.tlsFingerprint)
            return
        }
        val candidates = accountEndpointCandidates(connection.host)
        accountRouteJob?.cancel()
        accountRouteJob = scope.launch {
            for ((index, address) in candidates.withIndex()) {
                if (accountConnection !== connection || isManualDisconnect) return@launch
                if (index > 0) {
                    connectionGeneration++
                    webSocket?.cancel()
                    webSocket = null
                    reconnectScheduler.cancel()
                    _connectionStatus.value = ConnectionStatus.CONNECTING
                    showFeedback("Проверяем другой адрес ПК…")
                }
                performConnect(address, connection.host.port, "", false, false, connection.host.tlsFingerprint)
                delay(DIRECT_ROUTE_TIMEOUT_MS)
                if (accountConnection !== connection || connection.transportOpened || isManualDisconnect) {
                    accountRouteJob = null
                    return@launch
                }
            }
            val openRelay = connection.openRelay
            if (openRelay == null) {
                accountRouteJob = null
                triggerReconnect(candidates.firstOrNull().orEmpty(), connection.host.port, "")
                return@launch
            }
            connectionGeneration++
            webSocket?.cancel()
            webSocket = null
            reconnectScheduler.cancel()
            _connectionStatus.value = ConnectionStatus.CONNECTING
            showFeedback("Подключение к ПК через интернет…")
            try {
                val relay = openRelay.invoke()
                if (accountConnection !== connection || isManualDisconnect) { relay.bridge?.close(); return@launch }
                accountConnection = relay
                accountRouteJob = null
                startAccountConnection(relay)
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) {
                if (accountConnection === connection && !isManualDisconnect) {
                    showFeedback("Не удалось подключиться к ПК через интернет")
                    accountRouteJob = null
                    triggerReconnect(candidates.firstOrNull().orEmpty(), connection.host.port, "")
                }
            }
        }
    }

    fun connect(
        ip: String,
        port: Int,
        pinToken: String,
        forceSimulator: Boolean = false,
        advertisedTlsFingerprint: String? = null
    ) {
        accountRouteJob?.cancel()
        accountRouteJob = null
        accountConnection?.bridge?.close()
        accountConnection = null
        _accountApprovalCode.value = null
        performConnect(ip, port, pinToken, forceSimulator, false, advertisedTlsFingerprint)
    }

    private fun performConnect(
        ip: String,
        port: Int,
        pinToken: String,
        forceSimulator: Boolean,
        isRetry: Boolean,
        advertisedTlsFingerprint: String? = null
    ) {
        _authenticatedPeerIdentity.value = null
        if (!isRetry) {
            isManualDisconnect = false
            reconnectAttempts = 0
            reconnectScheduler.cancel()
        }
        val generation = ++connectionGeneration
        if (isRetry) accountConnection = accountConnection?.let {
            AccountConnection(it.host, it.identity, it.grant, it.accessToken, it.onGrant)
        }
        val account = accountConnection

        var targetIp = ip.trim()
        val fullPinToken = pinToken.trim()

        if (targetIp.isEmpty() && fullPinToken.length in listOf(9, 12) && fullPinToken.all { it.isDigit() }) {
            val localPrefix = getActiveDeviceSubnetPrefix()
            targetIp = decodePairingHostIp(fullPinToken, localPrefix).orEmpty()
            if (targetIp.isEmpty()) {
                showFeedback("Некорректный код подключения")
                return
            }
        }

        targetIp = if (account?.bridge != null && targetIp == "127.0.0.1") targetIp else remoteHostOrNull(targetIp).orEmpty()
        if (targetIp.isEmpty() || port !in 1..65535) {
            showFeedback("Укажите корректный IP-адрес или имя хоста и порт")
            return
        }

        _hostConfig.value = HostConfig(
            ip = targetIp,
            port = account?.host?.port ?: port,
            token = fullPinToken,
            hostName = account?.host?.name ?: targetIp,
            isSimulator = false,
            transport = account?.transport ?: "lan"
        )

        if (forceSimulator) {
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
            _connectionState.value = ConnectionState.Disconnected
            showFeedback("Режим симулятора отключен")
            return
        }

        _connectionStatus.value = ConnectionStatus.CONNECTING
        _connectionState.value = ConnectionState.Connecting

        addConnectionLog("$targetIp:$port", "LAN", "Initiating connection", "connecting")

        val advertisedPin = normalizeTlsFingerprint(advertisedTlsFingerprint)
        if (advertisedTlsFingerprint != null && advertisedPin == null) {
            showFeedback("QR-код содержит некорректный TLS-отпечаток")
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
            _connectionState.value = ConnectionState.Disconnected
            return
        }
        val expectedTlsFingerprint = account?.host?.tlsFingerprint ?: advertisedPin ?: tlsPinStore.get(targetIp, port)
        if (expectedTlsFingerprint == null) {
            showFeedback("Для первого подключения отсканируйте QR-код на ПК")
            _connectionStatus.value = ConnectionStatus.DISCONNECTED
            _connectionState.value = ConnectionState.Disconnected
            return
        }
        val prefs = getSecureSharedPreferences()
        prefs.edit().remove("token_$targetIp").apply()
        val guestTokenKey = if (account == null) {
            guestSessionTokenPreferenceKey(targetIp, port, expectedTlsFingerprint)
        } else null
        val savedSessionToken = if (secureStorageAvailable && guestTokenKey != null) {
            prefs.getString(guestTokenKey, "") ?: ""
        } else ""
        val attemptPeerFingerprint = AtomicReference<String?>(null)
        val attemptKey = Any()
        val routedClient = lanClient(context, sharedOkHttpClient, targetIp)
        val secureClient = buildTofuTlsClient(routedClient, expectedTlsFingerprint, attemptPeerFingerprint::set,
            allowRelayLoopback = account?.bridge != null)
        val attemptHostConfig = _hostConfig.value
        activeConnectionAttempt.set(ConnectionAttemptState(attemptKey, authenticated = false))

        webSocket?.close(1000, "Reconnecting")

        val request = Request.Builder()
            .url("wss://$targetIp:$port" + if (account?.bridge != null) "/account-relay/${account.sessionId}" else "/")
            .build()

        webSocket = secureClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                addConnectionLog("$targetIp:$port", "LAN", "Handshake & Authentication", "connecting")
                if (account != null) {
                    account.transportOpened = true
                    webSocket.send(JSONObject().put("action", "ACCOUNT_HELLO").put("ownerId", account.host.ownerId)
                        .put("hostId", account.host.id).put("phoneId", account.identity.id).put("sessionId", account.sessionId)
                        .put("grantId", account.grant?.grantId).put("accessToken", account.accessToken)
                        .put("capabilities", org.json.JSONArray(listOf("file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "aether-deck-v1", "clipboard-history-v1"))).toString())
                    return
                }
                val authJson = JSONObject().apply {
                    put("action", "AUTH")
                    put("deviceModel", "Android ${Build.MODEL}")
                    put("capabilities", org.json.JSONArray(listOf("file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "aether-deck-v1", "clipboard-history-v1")))
                    if (savedSessionToken.isNotEmpty()) {
                        put("sessionToken", savedSessionToken)
                    } else {
                        put("pin", fullPinToken)
                    }
                }
                webSocket.send(authJson.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                if (!isInboundTextWithinLimit(text) || !hasSafeJsonNesting(text)) {
                    webSocket.close(1009, "Message too large")
                    showFeedback("Хост прислал слишком большое сообщение")
                    return
                }
                parseIncomingMessage(text, generation, webSocket, account, attemptHostConfig, attemptPeerFingerprint.get(), attemptKey)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                if (bytes.size == 0) return
                val type = bytes[0]
                val maximum = if (type == 0x02.toByte()) MAX_INBOUND_AUDIO_BYTES + 1 else MAX_INBOUND_VIDEO_BYTES + 1
                if (bytes.size > maximum) {
                    webSocket.close(1009, "Binary message too large")
                    showFeedback("Хост прислал слишком большой бинарный блок")
                    return
                }
                val byteArray = bytes.toByteArray()

                if (type == 0x01.toByte()) {
                    val videoBytes = byteArray.copyOfRange(1, byteArray.size)
                    parseBinaryFrame(videoBytes)
                } else if (type == 0x02.toByte()) {
                    val audioBytes = byteArray.copyOfRange(1, byteArray.size)
                    playAudioChunk(audioBytes)
                } else {
                    parseBinaryFrame(byteArray)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                addConnectionLog("$targetIp:$port", "LAN", "Socket connection", "failed", t.message ?: "Network error / host unreachable")
                setLiveStreaming(false)
                clearConnectionAttempt(attemptKey)
                _authenticatedPeerIdentity.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                incomingFileOfferTimeoutJob?.cancel()
                incomingFileOfferTimeoutJob = null
                _incomingFileOffer.value = null
                abortIncomingFile(deletePartial = true)
                val tlsFailure = generateSequence(t) { it.cause }.any {
                    it is CertificateException || it is SSLPeerUnverifiedException
                }
                if (tlsFailure && account == null) {
                    isManualDisconnect = true
                    showFeedback("Защищённое соединение отклонено: сертификат ПК не совпадает")
                } else if (tlsFailure) {
                    showFeedback("Адрес не принадлежит выбранному ПК, проверяем следующий…")
                } else {
                    triggerReconnect(targetIp, port, pinToken)
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                addConnectionLog("$targetIp:$port", "LAN", "Socket closure", "failed", "Closed with code $code: $reason")
                setLiveStreaming(false)
                clearConnectionAttempt(attemptKey)
                _authenticatedPeerIdentity.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                incomingFileOfferTimeoutJob?.cancel()
                incomingFileOfferTimeoutJob = null
                _incomingFileOffer.value = null
                abortIncomingFile(deletePartial = true)
                triggerReconnect(targetIp, port, pinToken)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                if (generation != connectionGeneration || this@PcWebSocketManager.webSocket !== webSocket) return
                if (account != null && code == 1008) {
                    isManualDisconnect = true
                    _accountApprovalCode.value = null
                    showFeedback("ПК закрыл доступ аккаунта. Проверьте разрешение устройства.")
                }
                webSocket.close(code, reason)
            }
        })
    }

    private fun triggerReconnect(ip: String, port: Int, pinToken: String) {
        if (isManualDisconnect || reconnectScheduler.isScheduled) return
        val account = accountConnection
        if (account != null && !account.transportOpened && accountRouteJob?.isActive == true) return

        val backoffSec = when (reconnectAttempts) {
            0 -> 1L
            1 -> 2L
            2 -> 4L
            3 -> 8L
            else -> 16L
        }
        reconnectAttempts++

        _connectionStatus.value = ConnectionStatus.RECONNECTING
        _connectionState.value = ConnectionState.Reconnecting(reconnectAttempts, backoffSec)

        showFeedback("Переподключение через $backoffSec сек (попытка $reconnectAttempts)...")

        reconnectScheduler.schedule(backoffSec * 1000) {
            if (!isManualDisconnect && _connectionStatus.value != ConnectionStatus.CONNECTED) {
                if (account != null && account.refresh != null) {
                    account.bridge?.close()
                    try {
                        val fresh = account.refresh.invoke()
                        if (accountConnection === account && !isManualDisconnect) {
                            val attempts = reconnectAttempts
                            // The scheduler releases the retry before starting this attempt.
                            accountConnection = fresh
                            startAccountConnection(fresh)
                            reconnectAttempts = attempts
                        }
                    } catch (error: CancellationException) { throw error }
                    catch (_: Exception) {
                        if (accountConnection === account) triggerReconnect(ip, port, pinToken)
                        return@schedule
                    }
                } else performConnect(ip, port, pinToken, false, true)
            }
        }
    }

    private fun clearGuestToken(host: String, port: Int, peerFingerprint: String?) {
        val editor = getSecureSharedPreferences().edit().remove("token_$host")
        val fingerprint = peerFingerprint ?: tlsPinStore.get(host, port)
        fingerprint?.let { editor.remove(guestSessionTokenPreferenceKey(host, port, it)) }
        editor.apply()
    }

    private fun clearConnectionAttempt(attemptKey: Any) {
        while (true) {
            val current = activeConnectionAttempt.get() ?: return
            if (current.key !== attemptKey) return
            if (activeConnectionAttempt.compareAndSet(current, null)) return
        }
    }

    fun disconnect() {
        accountRouteJob?.cancel()
        accountRouteJob = null
        accountConnection?.bridge?.close()
        accountConnection = null
        _accountApprovalCode.value = null
        isManualDisconnect = true
        activeConnectionAttempt.set(null)
        _authenticatedPeerIdentity.value = null
        connectionGeneration++
        reconnectAttempts = 0
        reconnectScheduler.cancel()
        cancelScreenshotRequest()
        _isAudioStreamEnabled.value = false
        releaseAudioTrack()
        lastTelemetryTimestamp = 0L
        _isTelemetryStale.value = false
        streamLifecyclePolicy.resume(connected = false)
        setLiveStreaming(false)
        stopPingLoop()
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        pendingFileStartAcks.values.forEach { it.cancel() }
        pendingFileChunkAcks.values.forEach { it.cancel() }
        pendingFileEndAcks.values.forEach { it.cancel() }
        pendingFileStartAcks.clear()
        pendingFileChunkAcks.clear()
        pendingFileEndAcks.clear()
        incomingFileOfferTimeoutJob?.cancel()
        incomingFileOfferTimeoutJob = null
        _incomingFileOffer.value = null
        abortIncomingFile(deletePartial = true)
        _connectionStatus.value = ConnectionStatus.DISCONNECTED
        _connectionState.value = ConnectionState.Disconnected
        _systemStats.value = _systemStats.value.copy(monitorsCount = 1, currentMonitor = 1)
        deckStore.reset()
        deckAssetCache.clearPending()
        failedDeckAssets.clear()
    }

    private fun startPingLoop() {
        stopPingLoop()
        pingJob = scope.launch {
            scope.launch {
                delay(10000)
                if (_connectionStatus.value == ConnectionStatus.CONNECTED && _latencyMs.value == null) {
                    android.util.Log.w("PcWebSocketManager", "Warning: latencyMs is null after 10 seconds. PC server may not be returning timestamp in PONG!")
                }
            }
            while (_connectionStatus.value == ConnectionStatus.CONNECTED) {
                val json = JSONObject().apply {
                    put("action", "PING")
                    put("timestamp", System.currentTimeMillis())
                }
                webSocket?.send(json.toString())
                val now = System.currentTimeMillis()
                val lastTime = lastTelemetryTimestamp
                if (lastTime == 0L || now - lastTime > 5000L) {
                    webSocket?.send(JSONObject().put("action", "GET_TELEMETRY").toString())
                }
                if (lastTime > 0L) {
                    _isTelemetryStale.value = now - lastTime > 8000L
                } else {
                    _isTelemetryStale.value = false
                }
                
                delay(2000)
            }
        }
    }

    private fun stopPingLoop() {
        pingJob?.cancel()
        pingJob = null
    }

    fun setLiveStreaming(enabled: Boolean) {
        if (_connectionStatus.value != ConnectionStatus.CONNECTED) {
            _isLiveStreaming.value = false
            return
        }
        _isLiveStreaming.value = enabled
        liveStreamJob?.cancel()
        liveStreamJob = null
        val payload = JSONObject().apply {
            put("action", "STREAM_FRAME")
            put("start", enabled)
            put("command", if (enabled) "START" else "STOP")
            put("monitorIndex", (_systemStats.value.currentMonitor - 1).coerceAtLeast(0))
            put("quality", 70)
            put("resolution", "720p")
        }
        webSocket?.send(payload.toString())
    }

    fun onAppBackgrounded() {
        val selection = streamLifecyclePolicy.pause(
            live = _isLiveStreaming.value,
            audio = _isAudioStreamEnabled.value
        )
        if (selection.live) setLiveStreaming(false)
        if (selection.audio) toggleAudioStream(false)
    }

    fun onAppForegrounded() {
        val selection = streamLifecyclePolicy.resume(
            connected = _connectionStatus.value == ConnectionStatus.CONNECTED
        )
        if (selection.live) setLiveStreaming(true)
        if (selection.audio) toggleAudioStream(true)
    }

    private fun parseBinaryFrame(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val accepted = videoFrames.trySend(bytes).isSuccess
        val frameId = pendingFrameId.getAndSet(-1L)
        if (accepted) {
            _isCapturingScreenshot.value = false
            screenshotTimeoutJob?.cancel()
        }
        webSocket?.send(JSONObject().apply {
            put("action", "FRAME_ACK")
            put("receivedAt", System.currentTimeMillis())
            put("accepted", accepted)
            if (frameId >= 0L) put("frameId", frameId)
        }.toString())
    }

    private fun decodeBinaryFrame(bytes: ByteArray) {
        try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val width = bounds.outWidth
            val height = bounds.outHeight
            if (width !in 1..MAX_DECODED_IMAGE_DIMENSION ||
                height !in 1..MAX_DECODED_IMAGE_DIMENSION ||
                width.toLong() * height.toLong() > MAX_DECODED_IMAGE_PIXELS
            ) {
                _isCapturingScreenshot.value = false
                return
            }
            val options = BitmapFactory.Options().apply { inPreferredConfig = Bitmap.Config.RGB_565 }
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
            if (decoded != null) {
                _latestScreenshotBitmap.value = decoded
            }
        } catch (_: Exception) {
            _isCapturingScreenshot.value = false
        }
    }

    private fun playAudioChunk(bytes: ByteArray) {
        if (!_isAudioStreamEnabled.value || bytes.isEmpty()) return
        audioChunks.trySend(AudioChunk(audioGeneration.get(), bytes))
    }

    private fun writeAudioChunk(chunk: AudioChunk) {
        if (!_isAudioStreamEnabled.value || !audioPlaybackEnabled.get()) return
        synchronized(audioTrackLock) {
            if (chunk.generation != audioGeneration.get() || !_isAudioStreamEnabled.value || !audioPlaybackEnabled.get()) return
            try {
                val bytes = chunk.bytes
                var track = audioTrack.get()
                if (track == null) {
                    val sampleRate = 44100
                    val minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
                    val created = AudioTrack(
                        AudioManager.STREAM_MUSIC,
                        sampleRate,
                        AudioFormat.CHANNEL_OUT_STEREO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        maxOf(minBuf, bytes.size * 4),
                        AudioTrack.MODE_STREAM
                    )
                    created.play()
                    if (audioTrack.compareAndSet(null, created)) track = created
                    else {
                        runCatching { created.release() }
                        track = audioTrack.get()
                    }
                }
                if (_isAudioStreamEnabled.value && audioPlaybackEnabled.get()) {
                    track?.write(bytes, 0, bytes.size, AudioTrack.WRITE_NON_BLOCKING)
                }
            } catch (_: Exception) {}
        }
    }

    private fun releaseAudioTrack() {
        audioGeneration.incrementAndGet()
        while (audioChunks.tryReceive().isSuccess) Unit
        val track = synchronized(audioTrackLock) {
            audioPlaybackEnabled.set(false)
            audioTrack.getAndSet(null)
        } ?: return
        audioReleaseScope.launch {
            try { track.stop() } catch (_: Exception) {}
            try { track.release() } catch (_: Exception) {}
        }
    }

    fun sendAction(command: String, value: Int? = null, text: String? = null, dx: Int? = null, dy: Int? = null) {
        if (_connectionStatus.value != ConnectionStatus.CONNECTED) {
            return
        }

        val json = JSONObject().apply {
            when {
                command.startsWith("VOLUME_") || command.startsWith("MEDIA_") -> {
                    put("action", "MEDIA")
                    put("type", when (command) {
                        "VOLUME_SET", "VOLUME_UP", "VOLUME_DOWN", "VOLUME_MUTE" -> "VOLUME_SET"
                        "MEDIA_PLAY_PAUSE" -> "PLAY_PAUSE"
                        "MEDIA_NEXT" -> "SKIP_NEXT"
                        "MEDIA_PREV" -> "SKIP_PREV"
                        else -> command
                    })
                    put("command", when (command) {
                        "VOLUME_UP" -> "VOL_UP"
                        "VOLUME_DOWN" -> "VOL_DOWN"
                        "VOLUME_MUTE" -> "VOL_MUTE"
                        "VOLUME_SET" -> "VOL_SET"
                        "MEDIA_PLAY_PAUSE" -> "PLAY_PAUSE"
                        "MEDIA_NEXT" -> "NEXT_TRACK"
                        "MEDIA_PREV" -> "PREV_TRACK"
                        else -> command
                    })
                    value?.let { put("val", it) }
                }
                command.startsWith("POWER_") || command == "CLOSE_WINDOW" -> {
                    put("action", "POWER")
                    put("command", when (command) {
                        "POWER_SHUTDOWN" -> "SHUTDOWN"
                        "POWER_REBOOT" -> "REBOOT"
                        "POWER_LOCK" -> "LOCK"
                        "POWER_SLEEP" -> "SLEEP"
                        "CLOSE_WINDOW" -> "ALT_F4"
                        else -> command
                    })
                }
                command == "GET_CLIPBOARD" -> {
                    put("action", "CLIPBOARD")
                    put("command", "GET_CLIPBOARD")
                }
                command == "SET_CLIPBOARD" -> {
                    put("action", "CLIPBOARD")
                    put("command", "SET_CLIPBOARD")
                    put("text", text ?: "")
                }
                command == "KILL_PROCESS" -> {
                    put("action", "KILL_PROCESS")
                    put("process_name", text ?: "")
                }
                command == "SEND_TOAST" -> {
                    put("action", "SEND_TOAST")
                    put("title", "Aether Remote")
                    put("message", text ?: "")
                }
                command == "GET_SYSTEM_STATS" || command == "GET_TELEMETRY" -> {
                    put("action", "GET_TELEMETRY")
                }
                command == "STREAM_FRAME" -> {
                    put("action", "STREAM_FRAME")
                    put("start", true)
                    put("command", "START")
                }
                command == "GET_SCREENSHOT" || command == "TAKE_SCREENSHOT" -> {
                    put("action", "TAKE_SCREENSHOT")
                    put("monitorIndex", (_systemStats.value.currentMonitor - 1).coerceAtLeast(0))
                }
                command == "STOP_STREAM" -> {
                    put("action", "STREAM_FRAME")
                    put("start", false)
                    put("command", "STOP")
                }
                else -> {
                    put("action", command)
                    value?.let { put("value", it) }
                    text?.let { put("text", it) }
                }
            }
        }
        if (command == "SET_CLIPBOARD" && !text.isNullOrBlank()) {
            scope.launch { clipboardHistoryRepository.add(text) }
        }
        webSocket?.send(json.toString())
    }

    fun sendClipboardForPeer(expectedPeerIdentity: String, text: String): Boolean {
        val socket = webSocket ?: return false
        val generation = connectionGeneration
        if (_connectionStatus.value != ConnectionStatus.CONNECTED ||
            _authenticatedPeerIdentity.value != expectedPeerIdentity
        ) return false
        val payload = JSONObject().apply {
            put("action", "CLIPBOARD")
            put("command", "SET_CLIPBOARD")
            put("text", text)
        }.toString()
        if (generation != connectionGeneration || webSocket !== socket ||
            _authenticatedPeerIdentity.value != expectedPeerIdentity
        ) return false
        val sent = socket.send(payload)
        if (sent && text.isNotBlank()) scope.launch { clipboardHistoryRepository.add(text) }
        return sent
    }

    fun deleteClipboardHistoryItem(id: Long) {
        scope.launch { clipboardHistoryRepository.delete(id) }
    }

    fun clearClipboardHistory() {
        scope.launch { clipboardHistoryRepository.clear() }
    }

    private fun sendFileAck(action: String, fileId: String, status: String, error: String? = null, receivedBytes: Long? = null) {
        val payload = JSONObject().apply {
            put("action", action)
            put("fileId", fileId)
            put("status", status)
            error?.let { put("error", it) }
            receivedBytes?.let { put("receivedBytes", it) }
        }
        webSocket?.send(payload.toString())
    }

    fun acceptIncomingFile(fileId: String) {
        val offer = _incomingFileOffer.value?.takeIf { it.fileId == fileId } ?: return
        if (_connectionStatus.value != ConnectionStatus.CONNECTED) {
            rejectIncomingFile(fileId, "Соединение потеряно")
            return
        }
        synchronized(incomingFileLock) {
            if (currentIncomingFileId != null) {
                rejectIncomingFile(fileId, "Другая передача уже выполняется")
                return
            }
            try {
                openIncomingFile(offer.fileName)
                currentIncomingFileId = offer.fileId
                currentIncomingExpectedSize = offer.fileSize
                currentIncomingReceivedSize = 0L
            } catch (error: Exception) {
                abortIncomingFile(deletePartial = true)
                rejectIncomingFile(fileId, error.message ?: "Не удалось создать файл")
                return
            }
        }
        incomingFileOfferTimeoutJob?.cancel()
        incomingFileOfferTimeoutJob = null
        _incomingFileOffer.value = null
        _fileTransferProgress.value = FileTransferProgress(offer.fileId, offer.fileName, offer.fileSize, 0f, isUploading = false)
        sendFileAck("FILE_START_ACK", offer.fileId, "SUCCESS")
    }

    fun rejectIncomingFile(fileId: String, reason: String = "Пользователь отклонил файл") {
        val offer = _incomingFileOffer.value?.takeIf { it.fileId == fileId } ?: return
        incomingFileOfferTimeoutJob?.cancel()
        incomingFileOfferTimeoutJob = null
        _incomingFileOffer.value = null
        sendFileAck("FILE_START_ACK", offer.fileId, "ERROR", reason)
    }

    private fun decodeBase64Strict(value: String): ByteArray {
        if (value.isEmpty() || value.length > MAX_BASE64_CHUNK_CHARS || value.length % 4 != 0 || !value.matches(Regex("^[A-Za-z0-9+/]+={0,2}$"))) {
            throw IllegalArgumentException("Некорректный Base64-блок")
        }
        val decoded = Base64.decode(value, Base64.NO_WRAP)
        val normalizedInput = value.trimEnd('=')
        val normalizedDecoded = Base64.encodeToString(decoded, Base64.NO_WRAP).trimEnd('=')
        if (normalizedInput != normalizedDecoded) throw IllegalArgumentException("Повреждённый Base64-блок")
        return decoded
    }

    private fun abortIncomingFile(deletePartial: Boolean) {
        synchronized(incomingFileLock) {
            try { currentFileOutputStream?.close() } catch (_: Exception) {}
            if (deletePartial) {
                try {
                    currentFileUri?.let { context.contentResolver.delete(it, null, null) }
                    currentFileTarget?.delete()
                } catch (_: Exception) {}
            }
            currentFileOutputStream = null
            currentFileTarget = null
            currentFileUri = null
            currentIncomingFileId = null
            currentIncomingExpectedSize = 0L
            currentIncomingReceivedSize = 0L
        }
    }

    private fun openIncomingFile(fileName: String): String {
        val safeName = sanitizeIncomingFileName(fileName)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/AetherRemote")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Не удалось создать файл в Downloads")
            currentFileUri = uri
            currentFileOutputStream = context.contentResolver.openOutputStream(uri, "w")
                ?: throw IllegalStateException("Не удалось открыть файл для записи")
            return uri.toString()
        }

        val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "AetherRemote")
        if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Не удалось создать папку загрузок")
        val parsed = File(safeName)
        var target = File(directory, safeName)
        var suffix = 1
        while (target.exists()) {
            val stem = parsed.nameWithoutExtension
            val ext = parsed.extension.takeIf { it.isNotEmpty() }?.let { ".$it" } ?: ""
            target = File(directory, "$stem ($suffix)$ext")
            suffix++
        }
        currentFileTarget = target
        currentFileOutputStream = target.outputStream()
        return target.absolutePath
    }

    private fun publishIncomingFile() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            currentFileUri?.let { uri ->
                context.contentResolver.update(uri, ContentValues().apply {
                    put(MediaStore.Downloads.IS_PENDING, 0)
                }, null, null)
            }
        }
    }

    private fun parseIncomingMessage(
        jsonStr: String,
        attemptGeneration: Long,
        sourceSocket: WebSocket,
        attemptAccount: AccountConnection?,
        attemptHostConfig: HostConfig,
        attemptPeerFingerprint: String?,
        attemptKey: Any
    ) {
        fun isCurrentAttempt(): Boolean = attemptGeneration == connectionGeneration &&
            webSocket === sourceSocket && accountConnection === attemptAccount &&
            _hostConfig.value.ip == attemptHostConfig.ip && _hostConfig.value.port == attemptHostConfig.port &&
            activeConnectionAttempt.get()?.key === attemptKey
        fun claimAuthenticationCommit(): Boolean {
            while (true) {
                val current = activeConnectionAttempt.get() ?: return false
                if (current.key !== attemptKey || current.authenticated) return false
                if (activeConnectionAttempt.compareAndSet(current, current.copy(authenticated = true))) return true
            }
        }
        fun claimTerminalAttempt(): Boolean {
            while (true) {
                val current = activeConnectionAttempt.get() ?: return false
                if (current.key !== attemptKey) return false
                if (activeConnectionAttempt.compareAndSet(current, null)) return true
            }
        }
        if (!isCurrentAttempt()) return
        try {
            val json = JSONObject(jsonStr)

            val status = json.optString("status")
            if (status == "ACCOUNT_CHALLENGE") {
                if (!isCurrentAttempt()) return
                val account = attemptAccount ?: throw IllegalArgumentException("Unexpected account challenge")
                val challenge = AccountChallenge.fromJson(json)
                val enrolling = json.optBoolean("enrolling")
                if (account.proofSent || challenge.ownerId != account.host.ownerId || challenge.hostId != account.host.id ||
                    challenge.phoneId != account.identity.id || challenge.sessionId != account.sessionId || challenge.transport != account.transport ||
                    challenge.expiresAt <= System.currentTimeMillis() || challenge.expiresAt > System.currentTimeMillis() + 30000 ||
                    (enrolling && account.accessToken == null) ||
                    (!enrolling && account.grant != null && challenge.grantId != account.grant!!.grantId)) {
                    isManualDisconnect = true
                    sourceSocket.close(1008, "Account challenge mismatch")
                    return
                }
                account.proofSent = true
                account.enrolling = enrolling
                val digest = java.security.MessageDigest.getInstance("SHA-256").apply {
                    update(AccountProtocol.canonicalProof(challenge))
                    update(account.host.publicKeySpki.toByteArray(Charsets.UTF_8))
                }.digest()
                val value = (java.nio.ByteBuffer.wrap(digest).int.toLong() and 0xffffffffL) % 1000000
                _accountApprovalCode.value = if (json.optBoolean("enrolling")) "%06d".format(java.util.Locale.US, value) else null
                if (!isCurrentAttempt()) return
                sourceSocket.send(AccountProtocol.signProof(challenge, account.identity.privateKey)
                    .put("action", "ACCOUNT_PROOF").toString())
                return
            }
            if (status == "ACCOUNT_APPROVAL_PENDING") {
                if (!isCurrentAttempt()) return
                if (attemptAccount?.proofSent != true || json.optString("code") != _accountApprovalCode.value) {
                    isManualDisconnect = true
                    sourceSocket.close(1008, "Account approval mismatch")
                    return
                }
                _connectionStatus.value = ConnectionStatus.AWAITING_APPROVAL
                _connectionState.value = ConnectionState.AwaitingApproval
                showFeedback("Сверьте код ${_accountApprovalCode.value} и подтвердите телефон на ПК")
                return
            }
            if (status == "AUTH_OK") {
                if (!isCurrentAttempt()) return
                val protocolVersion = json.optString("protocolVersion")
                if (protocolVersion.isNotEmpty() && protocolVersion != "2.0") {
                    showFeedback("Версия ПК несовместима. Обновите Aether Remote")
                    sourceSocket.close(1002, "Unsupported protocol version")
                    return
                }
                val peerFingerprint = attemptPeerFingerprint
                val hostFingerprint = normalizeTlsFingerprint(json.optString("tlsFingerprint"))
                if (peerFingerprint == null || hostFingerprint == null || peerFingerprint != hostFingerprint) {
                    isManualDisconnect = true
                    _connectionStatus.value = ConnectionStatus.DISCONNECTED
                    _connectionState.value = ConnectionState.Disconnected
                    showFeedback("ПК не подтвердил защищённый TLS-канал")
                    sourceSocket.close(1008, "TLS identity mismatch")
                    return
                }
                val account = attemptAccount
                var verifiedGrant: AccountGrant? = null
                if (account != null) {
                    val grant = runCatching { AccountGrant.fromJson(json.getJSONObject("grant")) }.getOrNull()
                    if (json.optString("authMode") != "account" || !account.proofSent || grant == null ||
                        !AccountProtocol.verifyGrant(grant, account.host.publicKeySpki) || grant.ownerId != account.host.ownerId ||
                        grant.hostId != account.host.id || grant.phoneId != account.identity.id || normalizeTlsFingerprint(grant.hostTlsFingerprint) != peerFingerprint ||
                        (account.grant != null && if (account.enrolling) grant.revision <= account.grant!!.revision else grant.grantId != account.grant!!.grantId)) {
                        isManualDisconnect = true
                        sourceSocket.close(1008, "Account grant mismatch")
                        showFeedback("ПК не подтвердил разрешение аккаунта")
                        return
                    }
                    verifiedGrant = grant
                } else {
                    if (json.optString("authMode") == "account") { sourceSocket.close(1008, "Unexpected account response"); return }
                }
                if (!isCurrentAttempt() || !claimAuthenticationCommit()) return
                if (account != null) {
                    val grant = requireNotNull(verifiedGrant)
                    account.onGrant(grant)
                    account.grant = grant
                    account.accessToken = null
                    _accountApprovalCode.value = null
                } else {
                    tlsPinStore.save(attemptHostConfig.ip, attemptHostConfig.port, peerFingerprint)
                }
                reconnectAttempts = 0
                _authenticatedPeerIdentity.value = if (account != null) {
                    "account:${account.host.id}:$peerFingerprint"
                } else {
                    "guest:${guestSessionTokenPreferenceKey(attemptHostConfig.ip, attemptHostConfig.port, peerFingerprint)}"
                }
                _connectionStatus.value = ConnectionStatus.CONNECTED
                showFeedback("Авторизация успешна")
                addConnectionLog("${_hostConfig.value.ip}:${_hostConfig.value.port}", "LAN", "Handshake & Authentication", "success")

                val token = json.optString("sessionToken", json.optString("token", ""))
                if (account == null && token.isNotEmpty() && secureStorageAvailable) {
                    val prefs = getSecureSharedPreferences()
                    if (secureStorageAvailable) {
                        prefs.edit().putString(
                            guestSessionTokenPreferenceKey(attemptHostConfig.ip, attemptHostConfig.port, peerFingerprint),
                            token
                        ).apply()
                    }
                }

                val mac = json.optString("mac", json.optString("macAddress", ""))
                val hostName = json.optString("host", json.optString("hostname", _hostConfig.value.hostName))
                _hostConfig.value = _hostConfig.value.copy(
                    macAddress = mac,
                    hostName = hostName,
                    platform = HostPlatform.fromWire(json.optString("platform"))
                )
                _connectionState.value = ConnectionState.Connected(_hostConfig.value)

                pendingWakeTargetDeviceId = json.optString("wakeTargetDeviceId", "")
                if (json.optBoolean("trusted", false) && json.optBoolean("wakeBridgeAvailable", false) && pendingWakeTargetDeviceId.matches(Regex("^[0-9a-f]{32}$"))) {
                    val identity = wakeIdentityStore.loadOrCreate()
                    if (identity is WakeIdentityLoadResult.Ready) {
                        sourceSocket.send(JSONObject().apply {
                            put("action", "WAKE_ENROLL")
                            put("deviceId", identity.identity.deviceId)
                            put("publicKeySpki", Base64.encodeToString(identity.identity.publicKeySpki, Base64.NO_WRAP))
                        }.toString())
                    }
                }

                startPingLoop()
                sendAction("GET_TELEMETRY")
                val capabilities = json.optJSONArray("capabilities")
                val supportsDeck = capabilities == null || (0 until capabilities.length()).any {
                    capabilities.optString(it) == "aether-deck-v1"
                }
                if (supportsDeck) deckStore.requestDeckSync()
                else deckStore.markUnavailable("Для Aether Deck требуется полная версия хоста для Windows")
                return
            } else if (status == "AUTH_PENDING") {
                if (!isCurrentAttempt()) return
                _connectionStatus.value = ConnectionStatus.AWAITING_APPROVAL
                _connectionState.value = ConnectionState.AwaitingApproval
                showFeedback("Запрос отправлен на ПК")
                return
            } else if (status == "AUTH_REJECTED") {
                if (!isCurrentAttempt() || !claimTerminalAttempt()) return
                if (attemptAccount == null) clearGuestToken(attemptHostConfig.ip, attemptHostConfig.port, attemptPeerFingerprint)
                _accountApprovalCode.value = null
                attemptAccount?.bridge?.close()
                _authenticatedPeerIdentity.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                showFeedback("Подключение отклонено на ПК")
                addConnectionLog("${_hostConfig.value.ip}:${_hostConfig.value.port}", "LAN", "Authentication", "failed", "Подключение отклонено на ПК")
                isManualDisconnect = true
                connectionGeneration++
                sourceSocket.close(1008, "Connection rejected on PC")
                if (webSocket === sourceSocket) webSocket = null
                return
            } else if (status == "AUTH_FAILED" || status == "AUTH_BLOCKED") {
                if (!isCurrentAttempt() || !claimTerminalAttempt()) return
                if (attemptAccount == null) clearGuestToken(attemptHostConfig.ip, attemptHostConfig.port, attemptPeerFingerprint)

                _authenticatedPeerIdentity.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                val errorMsg = if (status == "AUTH_BLOCKED") {
                    showFeedback("Превышено количество попыток! Блокировка 60с.")
                    "Превышено количество попыток! Блокировка 60с."
                } else {
                    showFeedback("Неверный код подключения")
                    "Неверный код подключения"
                }
                addConnectionLog("${_hostConfig.value.ip}:${_hostConfig.value.port}", "LAN", "Authentication", "failed", errorMsg)
                isManualDisconnect = true
                connectionGeneration++
                sourceSocket.close(1008, "Authentication rejected")
                if (webSocket === sourceSocket) webSocket = null
                return
            }

            if (_connectionStatus.value != ConnectionStatus.CONNECTED) {
                isManualDisconnect = true
                showFeedback("Хост прислал данные до завершения авторизации")
                webSocket?.close(1008, "Authentication required")
                return
            }

            if (status == "FORCE_DISCONNECTED") {
                isManualDisconnect = true
                clearConnectionAttempt(attemptKey)
                connectionGeneration++
                reconnectAttempts = 0
                reconnectScheduler.cancel()
                stopPingLoop()
                setLiveStreaming(false)
                webSocket = null
                _authenticatedPeerIdentity.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                showFeedback("Соединение завершено на компьютере")
                return
            }

            if (status == "WAKE_ENROLL_OK") {
                val targets = json.optJSONArray("targets") ?: JSONArray()
                runCatching {
                    val preferences = getSecureSharedPreferences()
                    val editor = preferences.edit()
                    val targetIds = linkedSetOf<String>()
                    for (index in 0 until targets.length()) {
                        val target = targets.getJSONObject(index)
                        val targetId = target.getString("deviceId")
                        targetIds += targetId
                        val cleanMac = target.optString("mac").replace(":", "").replace("-", "").lowercase()
                        if (cleanMac.matches(Regex("^[0-9a-f]{12}$"))) editor.putString("wake_target_mac_$cleanMac", targetId)
                    }
                    if (targetIds.isEmpty() && pendingWakeTargetDeviceId.matches(Regex("^[0-9a-f]{32}$"))) {
                        targetIds += pendingWakeTargetDeviceId
                    }
                    for (targetId in targetIds) {
                        wakeEnrollmentStore.save(WakeEnrollment(
                            groupId = json.getString("groupId"),
                            targetDeviceId = targetId,
                            relayUrl = json.getString("relayUrl"),
                            certificateJson = json.getJSONObject("certificate").toString(),
                            ownerPublicKeySpki = json.getString("ownerPublicKeySpki")
                        ))
                    }
                    editor.apply()
                }
                return
            }

            if (status == "PONG" || json.optString("action") == "PONG") {
                val ts = json.optLong("timestamp", 0L)
                if (ts > 0) {
                    _latencyMs.value = System.currentTimeMillis() - ts
                }
            }

            val action = json.optString("action")
            if (action == "STREAM_FRAME_META") {
                val frameId = json.optLong("frameId", -1L)
                pendingFrameId.set(frameId.takeIf { it >= 0L } ?: -1L)
                return
            }
            if (action == "DECK_ASSET_CHUNK") {
                if (deckAssetCache.acceptChunk(json)) _deckAssetRevision.value += 1
                return
            }
            if (action == "DECK_ASSET_ERROR") {
                json.optString("hash").takeIf { it.isNotBlank() }?.let(failedDeckAssets::add)
                _deckAssetRevision.value += 1
                showFeedback("Не удалось загрузить иконку Aether Deck")
                return
            }
            if (action.startsWith("DECK_") && deckStore.handle(json)) return
            if (action == "FILE_START_ACK") {
                pendingFileStartAcks.remove(json.optString("fileId"))?.complete(json)
                return
            }
            if (action == "FILE_CHUNK_ACK") {
                pendingFileChunkAcks.remove(json.optString("fileId"))?.complete(json)
                return
            }
            if (action == "FILE_END_ACK") {
                pendingFileEndAcks.remove(json.optString("fileId"))?.complete(json)
                return
            }
            if (action == "STREAM_STATUS") {
                _isLiveStreaming.value = json.optBoolean("enabled", false) && json.optString("status") == "SUCCESS"
            }
            if (action == "AUDIO_STREAM_STATUS") {
                val streamStatus = json.optString("status")
                val enabled = isAudioStreamActive(json.optBoolean("enabled", false), streamStatus)
                _isAudioStreamEnabled.value = enabled
                audioPlaybackEnabled.set(enabled)
                if (!enabled) releaseAudioTrack()
                if (streamStatus == "ERROR") {
                    showFeedback(json.optString("error", "Не удалось включить звук ПК"))
                }
            }
            if (action == "TELEMETRY" || json.optString("type") == "SYSTEM_STATS_RESPONSE" || status == "TELEMETRY_OK") {
                val dataObj = json.optJSONObject("data")
                val cpu = if (dataObj != null) {
                    dataObj.optDouble("cpu", 0.0).toFloat()
                } else {
                    json.optDouble("cpu_percent", json.optDouble("cpu", json.optDouble("cpuPercent", 0.0))).toFloat()
                }
                val safeCpu = cpu.takeIf(Float::isFinite)?.coerceIn(0f, 100f) ?: 0f
                val ram = if (dataObj != null) {
                    dataObj.optDouble("ram", 0.0).toFloat()
                } else {
                    json.optDouble("ram_percent", json.optDouble("ram", json.optDouble("ramPercent", 0.0))).toFloat()
                }

                val previousMonitorsCount = _systemStats.value.monitorsCount.coerceAtLeast(1)
                val hasMonitorCount = dataObj?.has("monitorsCount") == true || json.has("monitorsCount") || json.has("monitors")
                val monitorsCount = if (hasMonitorCount) {
                    dataObj?.optInt("monitorsCount", json.optInt("monitorsCount", json.optInt("monitors", previousMonitorsCount)))
                        ?: json.optInt("monitorsCount", json.optInt("monitors", previousMonitorsCount))
                } else previousMonitorsCount
                val currentMon = dataObj?.optInt("currentMonitor", json.optInt("currentMonitor", 1)) ?: json.optInt("currentMonitor", 1)

                val hostname = (dataObj?.optString("hostname") ?: "").ifEmpty {
                    (json.optString("hostname") ?: "").ifEmpty {
                        _systemStats.value.hostname
                    }
                }
                val ramUsedGb = dataObj?.optDouble("ramUsedGb", Double.NaN) ?: Double.NaN
                val ramTotalGb = dataObj?.optDouble("ramTotalGb", Double.NaN) ?: Double.NaN
                val ramDetail = if (ramUsedGb.isFinite() && ramTotalGb.isFinite()) {
                    String.format(Locale.US, "%.1f GB / %.1f GB", ramUsedGb, ramTotalGb)
                } else _systemStats.value.ramDetail
                val uptimeSeconds = dataObj?.optLong("uptime", -1L) ?: -1L
                val uptime = if (uptimeSeconds >= 0) {
                    val days = uptimeSeconds / 86400
                    val hours = (uptimeSeconds % 86400) / 3600
                    val minutes = (uptimeSeconds % 3600) / 60
                    if (days > 0) "$days д $hours ч" else "$hours ч $minutes мин"
                } else _systemStats.value.uptime

                val safeRam = ram.takeIf(Float::isFinite)?.coerceIn(0f, 100f) ?: 0f
                _systemStats.value = _systemStats.value.copy(
                    cpu = safeCpu,
                    ram = safeRam,
                    monitorsCount = if (monitorsCount > 0) monitorsCount else 1,
                    currentMonitor = if (currentMon > 0) currentMon else 1,
                    hostname = hostname,
                    ramDetail = ramDetail,
                    uptime = uptime
                )
                lastTelemetryTimestamp = System.currentTimeMillis()
                _isTelemetryStale.value = false
            }
            
            val isMediaMessage = action == "NOW_PLAYING" || action == "MEDIA_RESPONSE" || status == "MEDIA_OK" || json.optString("type") == "NOW_PLAYING" || 
                                 json.has("track") || json.has("now_playing") || json.has("isPlaying") || json.has("is_playing")
            if (isMediaMessage || (json.has("data") && (json.optJSONObject("data")?.has("track") == true || json.optJSONObject("data")?.has("isPlaying") == true))) {
                val mediaData = json.optJSONObject("data") ?: json
                val track = mediaData.optString("track", mediaData.optString("title", mediaData.optString("now_playing", "")))
                val artist = mediaData.optString("artist", mediaData.optString("author", "PC Media Player"))
                val isPlaying = mediaData.optBoolean("isPlaying", mediaData.optBoolean("is_playing", _mediaState.value.isPlaying))
                val volume = mediaData.optInt("volume", _mediaState.value.volume).coerceIn(0, 100)
                val isMuted = mediaData.optBoolean("isMuted", _mediaState.value.isMuted)
                
                _mediaState.value = _mediaState.value.copy(
                    trackTitle = track.take(500).takeIf { it.isNotEmpty() } ?: _mediaState.value.trackTitle,
                    artistName = artist.take(200),
                    isPlaying = isPlaying,
                    volume = volume,
                    isMuted = isMuted
                )
            }

            if (action == "AUDIO_CHUNK") {
                val base64Data = json.optString("data", "")
                if (base64Data.isNotEmpty() && base64Data.length <= MAX_BASE64_CHUNK_CHARS) {
                    try {
                        val decodedBytes = Base64.decode(base64Data, Base64.DEFAULT)
                        if (decodedBytes.size <= MAX_INBOUND_AUDIO_BYTES) playAudioChunk(decodedBytes)
                    } catch (_: Exception) {}
                }
            }

            if (action == "FILE_CANCEL") {
                val cancelledOffer = _incomingFileOffer.value
                if (json.optString("fileId") == cancelledOffer?.fileId) {
                    incomingFileOfferTimeoutJob?.cancel()
                    incomingFileOfferTimeoutJob = null
                    _incomingFileOffer.value = null
                    return
                }
                synchronized(incomingFileLock) {
                    if (json.optString("fileId") == currentIncomingFileId) {
                        abortIncomingFile(deletePartial = true)
                        _fileTransferProgress.value = null
                        showFeedback("Передача файла отменена на ПК")
                    }
                }
                return
            }
            if (action == "FILE_START") {
                val fId = json.optString("fileId", "file_${System.currentTimeMillis()}")
                val fName = json.optString("fileName", "downloaded_file.bin")
                val fSize = json.optLong("fileSize", 0L)
                val offer = validateIncomingFileOffer(fId, fName, fSize)
                if (offer == null) {
                    sendFileAck("FILE_START_ACK", fId, "ERROR", "Некорректный идентификатор или размер файла")
                    return
                }
                if (_incomingFileOffer.value != null || synchronized(incomingFileLock) { currentIncomingFileId != null }) {
                    sendFileAck("FILE_START_ACK", fId, "ERROR", "Другая передача уже выполняется")
                    return
                }
                _incomingFileOffer.value = offer
                incomingFileOfferTimeoutJob?.cancel()
                incomingFileOfferTimeoutJob = scope.launch {
                    delay(25_000)
                    rejectIncomingFile(offer.fileId, "Истекло время подтверждения")
                }
                showFeedback("ПК предлагает файл: ${offer.fileName}")
            } else if (action == "FILE_CHUNK") {
                val fId = json.optString("fileId")
                val chunkStr = json.optString("chunk", json.optString("data", ""))
                val receivedBytes = synchronized(incomingFileLock) {
                    val offset = json.optLong("offset", currentIncomingReceivedSize)
                    when (incomingFileChunkDecision(fId, currentIncomingFileId, offset, currentIncomingReceivedSize, chunkStr)) {
                        IncomingFileChunkDecision.REJECT_CHUNK -> {
                            sendFileAck("FILE_CHUNK_ACK", fId, "ERROR", "Неизвестная передача файла")
                            return
                        }
                        IncomingFileChunkDecision.ABORT_TRANSFER -> {
                            abortIncomingFile(deletePartial = true)
                            _fileTransferProgress.value = null
                            sendFileAck("FILE_CHUNK_ACK", fId, "ERROR", "Неожиданный или нарушающий порядок блок файла")
                            return
                        }
                        IncomingFileChunkDecision.ACCEPT -> Unit
                    }
                    try {
                        val chunkBytes = decodeBase64Strict(chunkStr)
                        if (currentIncomingReceivedSize + chunkBytes.size > currentIncomingExpectedSize) {
                            throw IllegalStateException("Получено больше данных, чем заявлено")
                        }
                        currentFileOutputStream?.write(chunkBytes) ?: throw IllegalStateException("Файл не открыт")
                        currentIncomingReceivedSize += chunkBytes.size
                        currentIncomingReceivedSize
                    } catch (e: Exception) {
                        abortIncomingFile(deletePartial = true)
                        sendFileAck("FILE_CHUNK_ACK", fId, "ERROR", e.message ?: "Ошибка записи блока")
                        return
                    }
                }

                val expectedBytes = synchronized(incomingFileLock) { currentIncomingExpectedSize }
                val progress = if (expectedBytes == 0L) 1f
                    else (receivedBytes.toFloat() / expectedBytes.toFloat()).coerceIn(0f, 1f)
                _fileTransferProgress.value = _fileTransferProgress.value?.copy(
                    progress = progress
                )
                sendFileAck("FILE_CHUNK_ACK", fId, "SUCCESS", receivedBytes = receivedBytes)
            } else if (action == "FILE_END") {
                val fId = json.optString("fileId")
                val completed = synchronized(incomingFileLock) {
                    if (fId != currentIncomingFileId || currentIncomingReceivedSize != currentIncomingExpectedSize) {
                        val received = currentIncomingReceivedSize
                        val expected = currentIncomingExpectedSize
                        abortIncomingFile(deletePartial = true)
                        sendFileAck("FILE_END_ACK", fId, "ERROR", "Неполный файл: $received из $expected байт")
                        return
                    }
                    try {
                        currentFileOutputStream?.flush()
                        currentFileOutputStream?.close()
                        publishIncomingFile()
                    } catch (e: Exception) {
                        abortIncomingFile(deletePartial = true)
                        sendFileAck("FILE_END_ACK", fId, "ERROR", e.message ?: "Не удалось завершить файл")
                        return
                    }
                    currentFileOutputStream = null
                    Triple(currentIncomingReceivedSize, currentFileUri?.toString(), currentFileTarget?.absolutePath)
                }

                val current = _fileTransferProgress.value
                val fName = current?.fileName ?: json.optString("fileName", "file_${System.currentTimeMillis()}")
                val fSize = completed.first
                val savedPath = completed.second ?: completed.third ?: "Downloads/AetherRemote/$fName"

                val newFile = ReceivedFile(
                    id = fId.ifEmpty { System.currentTimeMillis().toString() },
                    fileName = fName,
                    fileSize = fSize,
                    savedPath = savedPath
                )
                _receivedFiles.value = listOf(newFile) + _receivedFiles.value.filter { it.id != newFile.id }
                _fileTransferProgress.value = FileTransferProgress(
                    fileId = fId,
                    fileName = fName,
                    fileSize = fSize,
                    progress = 1.0f,
                    isUploading = false,
                    isCompleted = true
                )
                showFeedback("Файл принят с ПК: $fName")
                sendFileAck("FILE_END_ACK", fId, "SUCCESS", receivedBytes = fSize)
                abortIncomingFile(deletePartial = false)
            }

            if (clipboardMessageKind(action, json.optString("type")) == ClipboardMessageKind.PC_CONTENT) {
                val text = json.optString("text").take(100_000)
                _clipboardData.value = ClipboardData(text = text)
            }

            if (status == "NEED_ADMIN_CONFIRM" || action == "NEED_ADMIN_CONFIRM") {
                _adminConfirmCommand.value = json.optString("command", "Unknown Command")
                return
            }
            if (action == "PS_OUTPUT" || action == "POWERSHELL_OUTPUT" || action == "POWERSHELL_RESPONSE" || action == "PROCESS_LIST" || action == "PS_OUTPUT_OK") {
                val outputText = json.optString("output", json.optString("text", json.optString("data", "")))
                _actionFeedback.value = outputText
            }

            if (action == "TAKE_SCREENSHOT_RESPONSE" && status == "ERROR") {
                screenshotTimeoutJob?.cancel()
                _isCapturingScreenshot.value = false
                showFeedback(json.optString("error", "Не удалось получить снимок экрана"))
            }

            if (status == "ERROR") {
                showFeedback(json.optString("error", json.optString("message", "Команда завершилась ошибкой")))
            }

            if (status == "COMMAND_SUCCESS" || status == "OK") {
                _actionFeedback.value = "Выполнено"
            }
        } catch (_: Exception) {
            if (accountConnection != null && _connectionStatus.value != ConnectionStatus.CONNECTED) {
                isManualDisconnect = true
                _accountApprovalCode.value = null
                _connectionStatus.value = ConnectionStatus.DISCONNECTED
                _connectionState.value = ConnectionState.Disconnected
                webSocket?.close(1008, "Invalid account response")
                accountConnection?.bridge?.close()
                showFeedback("ПК прислал некорректное подтверждение аккаунта")
            }
        }
    }

    fun takeScreenshot() {
        if (_connectionStatus.value == ConnectionStatus.CONNECTED) {
            _isCapturingScreenshot.value = true
            sendAction("TAKE_SCREENSHOT")
            screenshotTimeoutJob?.cancel()
            screenshotTimeoutJob = scope.launch {
                delay(10000)
                if (_isCapturingScreenshot.value) {
                    _isCapturingScreenshot.value = false
                    showFeedback("Снимок экрана не получен: истекло время ожидания")
                }
            }
        }
    }

    fun cancelScreenshotRequest() {
        screenshotTimeoutJob?.cancel()
        screenshotTimeoutJob = null
        _isCapturingScreenshot.value = false
    }

    fun toggleAudioStream(enabled: Boolean) {
        if (!enabled) {
            _isAudioStreamEnabled.value = false
            releaseAudioTrack()
        }
        val json = JSONObject().apply {
            put("action", "AUDIO_STREAM")
            put("enabled", enabled)
        }
        if (webSocket?.send(json.toString()) != true) {
            _isAudioStreamEnabled.value = false
            showFeedback("Не удалось отправить команду аудиопотока")
        }
    }

    fun switchMonitor(monitorIndex: Int) {
        val displayIndex = monitorIndex.coerceIn(1, _systemStats.value.monitorsCount.coerceAtLeast(1))
        _systemStats.value = _systemStats.value.copy(currentMonitor = displayIndex)
        val json = JSONObject().apply {
            put("action", "STREAM_FRAME")
            put("monitorIndex", displayIndex - 1)
            put("start", _isLiveStreaming.value)
        }
        webSocket?.send(json.toString())
        showFeedback("Переключено на Монитор $displayIndex")
    }

    private suspend fun sendAndAwaitFileAck(
        fileId: String,
        payload: JSONObject,
        pendingMap: ConcurrentHashMap<String, CompletableDeferred<JSONObject>>,
        expectedAction: String,
        socket: WebSocket,
        generation: Long,
        expectedPeerIdentity: String?
    ): JSONObject {
        val deferred = CompletableDeferred<JSONObject>()
        pendingMap[fileId] = deferred
        try {
            requireTransferConnection(socket, generation, expectedPeerIdentity)
            if (!socket.send(payload.toString())) throw IllegalStateException("Соединение потеряно")
            val response = withTimeout(10000) { deferred.await() }
            requireTransferConnection(socket, generation, expectedPeerIdentity)
            if (response.optString("action") != expectedAction || response.optString("status") != "SUCCESS") {
                throw IllegalStateException(response.optString("error", "ПК отклонил передачу файла"))
            }
            return response
        } finally {
            pendingMap.remove(fileId, deferred)
        }
    }

    fun sendFileStreamToPc(fileName: String, fileSize: Long, inputStream: java.io.InputStream) {
        sendFileStreamToPc(fileName, fileSize, inputStream, null)
    }

    fun sendFileStreamToPcForPeer(
        expectedPeerIdentity: String,
        fileName: String,
        fileSize: Long,
        inputStream: java.io.InputStream
    ) {
        sendFileStreamToPc(fileName, fileSize, inputStream, expectedPeerIdentity)
    }

    private fun requireTransferConnection(socket: WebSocket, generation: Long, expectedPeerIdentity: String?) {
        check(_connectionStatus.value == ConnectionStatus.CONNECTED &&
            connectionGeneration == generation && webSocket === socket &&
            (expectedPeerIdentity == null || _authenticatedPeerIdentity.value == expectedPeerIdentity)
        ) { "Соединение с выбранным ПК потеряно" }
    }

    private fun sendFileStreamToPc(
        fileName: String,
        fileSize: Long,
        inputStream: java.io.InputStream,
        expectedPeerIdentity: String?
    ) {
        val transferSocket = webSocket
        val transferGeneration = connectionGeneration
        if (transferSocket == null || _connectionStatus.value != ConnectionStatus.CONNECTED ||
            (expectedPeerIdentity != null && _authenticatedPeerIdentity.value != expectedPeerIdentity)
        ) {
            showFeedback("Ошибка: нет подключения к ПК")
            try { inputStream.close() } catch (_: Exception) {}
            return
        }

        scope.launch(Dispatchers.IO) {
            val fileId = "file_${System.currentTimeMillis()}"
            var transferStream = inputStream
            var stagedFile: File? = null
            try {
                val actualSize = if (fileSize < 0) {
                    val temporary = File.createTempFile("aether-share-", ".tmp", context.cacheDir)
                    stagedFile = temporary
                    inputStream.use { source ->
                        temporary.outputStream().use { target ->
                            val stagingBuffer = ByteArray(64 * 1024)
                            var total = 0L
                            while (true) {
                                val count = source.read(stagingBuffer)
                                if (count < 0) break
                                total += count
                                if (total > MAX_TRANSFER_FILE_BYTES) throw IllegalArgumentException("Размер файла должен быть не больше 500 МБ")
                                target.write(stagingBuffer, 0, count)
                            }
                        }
                    }
                    transferStream = temporary.inputStream()
                    temporary.length()
                } else fileSize
                if (actualSize > MAX_TRANSFER_FILE_BYTES) {
                    throw IllegalArgumentException("Размер файла должен быть не больше 500 МБ")
                }
                val startJson = JSONObject().apply {
                    put("action", "FILE_START")
                    put("fileId", fileId)
                    put("fileName", fileName)
                    put("fileSize", actualSize)
                }
                sendAndAwaitFileAck(fileId, startJson, pendingFileStartAcks, "FILE_START_ACK", transferSocket, transferGeneration, expectedPeerIdentity)

                _fileTransferProgress.value = FileTransferProgress(
                    fileId = fileId,
                    fileName = fileName,
                    fileSize = actualSize,
                    progress = 0f,
                    isUploading = true
                )

                val buffer = ByteArray(64 * 1024)
                var bytesRead: Int
                var totalSent = 0L
                var chunkIndex = 0

                while (transferStream.read(buffer).also { bytesRead = it } != -1) {
                    if (bytesRead > 0) {
                        val chunkBytes = if (bytesRead == buffer.size) buffer else buffer.copyOf(bytesRead)
                        val base64Chunk = Base64.encodeToString(chunkBytes, Base64.NO_WRAP)
                        val currentOffset = totalSent
                        totalSent += bytesRead
                        val safeSize = if (actualSize > 0) actualSize else 1L
                        val progressPercent = ((totalSent.toFloat() / safeSize.toFloat()) * 100f).coerceIn(0f, 100f)

                        _fileTransferProgress.value = FileTransferProgress(
                            fileId = fileId,
                            fileName = fileName,
                            fileSize = actualSize,
                            progress = (totalSent.toFloat() / safeSize.toFloat()).coerceIn(0f, 1f),
                            isUploading = true
                        )

                        val chunkJson = JSONObject().apply {
                            put("action", "FILE_CHUNK")
                            put("fileId", fileId)
                            put("chunk", base64Chunk)
                            put("data", base64Chunk)
                            put("progress", progressPercent)
                            put("chunkIndex", chunkIndex)
                            put("offset", currentOffset)
                        }
                        sendAndAwaitFileAck(fileId, chunkJson, pendingFileChunkAcks, "FILE_CHUNK_ACK", transferSocket, transferGeneration, expectedPeerIdentity)
                        chunkIndex++
                    }
                }

                if (totalSent != actualSize) {
                    throw IllegalStateException("Прочитано $totalSent байт, ожидалось $actualSize")
                }

                val endJson = JSONObject().apply {
                    put("action", "FILE_END")
                    put("fileId", fileId)
                }
                sendAndAwaitFileAck(fileId, endJson, pendingFileEndAcks, "FILE_END_ACK", transferSocket, transferGeneration, expectedPeerIdentity)

                _fileTransferProgress.value = FileTransferProgress(
                    fileId = fileId,
                    fileName = fileName,
                    fileSize = actualSize,
                    progress = 1.0f,
                    isUploading = true,
                    isCompleted = true
                )

                showFeedback("Файл $fileName успешно отправлен на ПК!")
            } catch (e: CancellationException) {
                transferSocket.send(JSONObject().apply {
                    put("action", "FILE_CANCEL")
                    put("fileId", fileId)
                }.toString())
                throw e
            } catch (e: Exception) {
                transferSocket.send(JSONObject().apply {
                    put("action", "FILE_CANCEL")
                    put("fileId", fileId)
                }.toString())
                showFeedback("Ошибка передачи файла: ${e.message}")
            } finally {
                try { transferStream.close() } catch (_: Exception) {}
                if (transferStream !== inputStream) try { inputStream.close() } catch (_: Exception) {}
                stagedFile?.delete()
            }
        }
    }

    fun sendFileToPc(fileName: String, fileSize: Long, fileBytes: ByteArray) {
        if (fileSize != fileBytes.size.toLong()) {
            showFeedback("Ошибка: размер файла не совпадает с фактическими данными")
            return
        }
        sendFileStreamToPc(fileName, fileSize, fileBytes.inputStream())
    }

    fun sendWakeOnLan(macAddress: String) {
        scope.launch(Dispatchers.IO) {
            try {
                WolUtils.sendMagicPacket(macAddress)
                showFeedback("WOL Magic Packet отправлен на $macAddress!")
            } catch (e: Exception) {
                showFeedback("Ошибка отправки WOL: ${e.message}")
            }
        }
    }

    fun wakeCurrentPc() {
        val macAddress = _hostConfig.value.macAddress
        if (macAddress.isBlank()) {
            showFeedback("MAC-адрес компьютера пока неизвестен")
            return
        }
        scope.launch(Dispatchers.IO) {
            val preferences = getSecureSharedPreferences()
            val cleanMac = macAddress.replace(":", "").replace("-", "").lowercase()
            val targetId = preferences.getString("wake_target_mac_$cleanMac", "").orEmpty()
            val enrollment = targetId.takeIf { it.matches(Regex("^[0-9a-f]{32}$")) }
                ?.let(wakeEnrollmentStore::get)
            val identity = wakeIdentityStore.loadOrCreate()
            if (enrollment != null && identity is WakeIdentityLoadResult.Ready) {
                showFeedback("Ищем способ включения…")
                val coordinator = WakeCoordinator(
                    identity = identity.identity,
                    sign = wakeIdentityStore::sign,
                    localWake = WolUtils::sendMagicPacket,
                    remoteTransport = WakeRelayTransport(OkHttpWakeSocketFactory(sharedOkHttpClient))
                )
                coordinator.wake(enrollment, macAddress)
                val state = coordinator.state.value[targetId]
                showFeedback(when (state?.stage) {
                    WakeStage.ONLINE -> "Компьютер включён"
                    WakeStage.FAILED -> "Не удалось включить: ${state.errorCode}"
                    else -> "Команда отправлена, компьютер запускается"
                })
            } else {
                runCatching { WolUtils.sendMagicPacket(macAddress) }
                    .onSuccess { showFeedback("Команда включения отправлена") }
                    .onFailure { showFeedback("Не удалось отправить Wake-on-LAN: ${it.message}") }
            }
        }
    }

    private fun showFeedback(msg: String) {
        scope.launch {
            _actionFeedback.value = msg
            delay(2500)
            if (_actionFeedback.value == msg) {
                _actionFeedback.value = null
            }
        }
    }
}
