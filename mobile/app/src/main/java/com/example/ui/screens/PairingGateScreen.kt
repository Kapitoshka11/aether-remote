package com.example.ui.screens

import android.content.Context
import android.net.Uri
import android.net.wifi.WifiManager
import android.widget.Toast
import com.example.data.AetherPreferences
import com.example.network.privateLanIpv4OrNull
import com.example.network.remoteHostOrNull
import com.example.network.buildTofuTlsClient
import com.example.network.lanClient
import com.example.network.normalizeTlsFingerprint
import com.example.network.guestSessionTokenPreferenceKey
import com.example.network.TlsPinStore
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.zIndex
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.components.AetherBackdrop
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.GlassWhiteUltraThin
import com.example.ui.theme.PitchBlack
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.wake.WakeTutorialPreferences
import com.example.wake.OkHttpWakeSocketFactory
import com.example.wake.WakeCoordinator
import com.example.wake.WakeEnrollmentStore
import com.example.wake.WakeIdentityLoadResult
import com.example.wake.WakeIdentityStore
import com.example.wake.WakeRelayTransport
import com.example.wake.WakeStage
import com.example.ui.components.WakeOnLanTutorialSheet
import com.example.account.AccountDevice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume

data class SavedPc(
    val id: String,
    val hostName: String,
    val hostIp: String,
    val hostPort: Int,
    val pin: String = "",
    val macAddress: String = "",
    val lastConnected: Long,
    val isAutoDiscovered: Boolean = false,
    val wakeTargetDeviceId: String = "",
    val tlsFingerprint: String = ""
)

internal suspend fun receiveDatagramCancellable(socket: DatagramSocket, packet: DatagramPacket) {
    suspendCancellableCoroutine<Unit> { continuation ->
        continuation.invokeOnCancellation { socket.close() }
        try {
            socket.receive(packet)
            if (continuation.isActive) continuation.resume(Unit)
        } catch (error: Exception) {
            if (continuation.isActive) continuation.resumeWith(Result.failure(error))
        }
    }
}

internal data class PairingQrPayload(val host: String, val port: Int, val pin: String, val tlsFingerprint: String?)

internal fun PairingQrPayload.withRemoteEndpoint(hostInput: String, portInput: String): PairingQrPayload? {
    if (hostInput.isBlank()) return this
    val host = remoteHostOrNull(hostInput) ?: return null
    val port = portInput.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
    return copy(host = host, port = port)
}

internal sealed interface PairingQrScanDecision {
    data class Accepted(val payload: PairingQrPayload) : PairingQrScanDecision
    data object Invalid : PairingQrScanDecision
    data object Ignored : PairingQrScanDecision
}

internal class PairingQrScanGate(
    private val invalidRepeatWindowMs: Long = 1_500L
) {
    private var accepted = false
    private var lastInvalidRaw: String? = null
    private var lastInvalidAt = Long.MIN_VALUE

    fun consume(raw: String, nowMs: Long): PairingQrScanDecision {
        if (accepted) return PairingQrScanDecision.Ignored
        val payload = parseAetherPairingQr(raw)
        if (payload != null) {
            accepted = true
            return PairingQrScanDecision.Accepted(payload)
        }
        if (raw == lastInvalidRaw && nowMs - lastInvalidAt < invalidRepeatWindowMs) {
            return PairingQrScanDecision.Ignored
        }
        lastInvalidRaw = raw
        lastInvalidAt = nowMs
        return PairingQrScanDecision.Invalid
    }

    fun reset() {
        accepted = false
        lastInvalidRaw = null
        lastInvalidAt = Long.MIN_VALUE
    }
}

internal fun parseAetherPairingQr(raw: String): PairingQrPayload? {
    val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return null
    val host = remoteHostOrNull(uri.host.orEmpty()) ?: return null
    val parsedPort = uri.port
    val hasExplicitPort = uri.encodedAuthority.orEmpty().contains(':')
    if (hasExplicitPort && parsedPort !in 1..65535) return null
    val port = parsedPort.takeIf { it in 1..65535 } ?: 8080
    val pin = uri.getQueryParameter("pin").orEmpty()
    val tlsFingerprint = normalizeTlsFingerprint(uri.getQueryParameter("tlsFingerprint"))
    if (uri.getQueryParameter("tlsFingerprint") != null && tlsFingerprint == null) return null
    return if (uri.scheme == "aether" && host.isNotBlank() && pin.length in listOf(9, 12) && pin.all(Char::isDigit)) {
        PairingQrPayload(host, port, pin, tlsFingerprint)
    } else null
}

private fun getSecureSharedPreferences(context: Context): android.content.SharedPreferences {
    return AetherPreferences.secure(context)
}

private suspend fun fetchVerifiedHost(context: Context, client: OkHttpClient, ip: String, port: Int): JSONObject? {
    if (port !in 1..65535) return null
    val host = privateLanIpv4OrNull(ip) ?: return null
    val peerFingerprint = AtomicReference<String?>(null)
    // Discovery sends no credentials. Its certificate must never become an authentication pin.
    val secureClient = buildTofuTlsClient(lanClient(context, client, host), null, peerFingerprint::set, allowUnpinnedDiscovery = true)
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
                    val json = runCatching { JSONObject(it.body?.string().orEmpty()) }.getOrNull() ?: return@use null
                    json.takeIf { payload ->
                        payload.optString("status") == "ok" &&
                            payload.optString("protocolVersion") == "2.0" &&
                            payload.optBoolean("secure", false) &&
                            normalizeTlsFingerprint(payload.optString("tlsFingerprint")) == peerFingerprint.get()
                    }?.put("tlsFingerprint", peerFingerprint.get())
                }
                if (continuation.isActive) continuation.resume(verified)
            }
        })
    }
}

private fun getLocalSubnetPrefixes(): List<String> = try {
    NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback && !it.isVirtual }
        .flatMap { it.inetAddresses.toList() }
        .filterIsInstance<Inet4Address>()
        .filter { it.isSiteLocalAddress }
        .mapNotNull { address -> address.hostAddress?.substringBeforeLast('.')?.plus(".") }
        .distinct()
} catch (_: Exception) {
    emptyList()
}

private fun getSavedPcs(context: Context): List<SavedPc> {
    val prefs = getSecureSharedPreferences(context)
    val jsonStr = prefs.getString("saved_pcs", "[]") ?: "[]"
    val list = mutableListOf<SavedPc>()
    try {
        val array = JSONArray(jsonStr)
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            list.add(
                SavedPc(
                    id = obj.getString("id"),
                    hostName = obj.getString("hostName"),
                    hostIp = obj.getString("hostIp"),
                    hostPort = obj.getInt("hostPort"),
                    pin = "",
                    macAddress = obj.optString("macAddress", ""),
                    lastConnected = obj.getLong("lastConnected"),
                    isAutoDiscovered = obj.optBoolean("isAutoDiscovered", false),
                    wakeTargetDeviceId = obj.optString("wakeTargetDeviceId", "").ifBlank {
                        prefs.getString("wake_target_${obj.getString("hostIp")}", "").orEmpty()
                    },
                    tlsFingerprint = normalizeTlsFingerprint(obj.optString("tlsFingerprint")) ?: ""
                )
            )
        }
    } catch (e: Exception) {
        e.printStackTrace()
    }
    return list
}

private fun saveSavedPcs(context: Context, pcs: List<SavedPc>) {
    val prefs = getSecureSharedPreferences(context)
    val array = JSONArray()
    for (pc in pcs) {
        val obj = JSONObject().apply {
            put("id", pc.id)
            put("hostName", pc.hostName)
            put("hostIp", pc.hostIp)
            put("hostPort", pc.hostPort)
            put("macAddress", pc.macAddress)
            put("lastConnected", pc.lastConnected)
            put("isAutoDiscovered", pc.isAutoDiscovered)
            put("tlsFingerprint", pc.tlsFingerprint)
            put("wakeTargetDeviceId", pc.wakeTargetDeviceId)
        }
        array.put(obj)
    }
    prefs.edit().putString("saved_pcs", array.toString()).apply()
}

@Composable
fun PairingGateScreen(
    onConnect: (ip: String, port: Int, pin: String, isSim: Boolean, tlsFingerprint: String?) -> Unit,
    onOpenSettings: () -> Unit = {},
    accountHosts: List<AccountDevice> = emptyList(),
    onConnectAccountHost: (AccountDevice) -> Unit = {}
) {
    val context = LocalContext.current
    val isCompactHeight = LocalConfiguration.current.screenHeightDp < 500
    val tlsPinStore = remember(context) { TlsPinStore(context) }
    val coroutineScope = rememberCoroutineScope()
    val discoveryClient = remember {
        OkHttpClient.Builder()
            .connectTimeout(350, TimeUnit.MILLISECONDS)
            .readTimeout(500, TimeUnit.MILLISECONDS)
            .callTimeout(900, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }
    fun persistSavedPcs(pcs: List<SavedPc>) {
        coroutineScope.launch(Dispatchers.IO) { saveSavedPcs(context, pcs) }
    }
    var savedPcsList by remember { mutableStateOf(getSavedPcs(context)) }
    val wakeTutorialPreferences = remember { WakeTutorialPreferences(getSecureSharedPreferences(context)) }
    var wakeTutorialPc by remember { mutableStateOf<SavedPc?>(null) }
    var dismissWakeTutorial by remember { mutableStateOf(false) }

    fun sendLocalWake(pc: SavedPc) {
        if (pc.macAddress.isBlank()) {
            Toast.makeText(context, "MAC-адрес компьютера пока неизвестен", Toast.LENGTH_SHORT).show()
            return
        }
        coroutineScope.launch(Dispatchers.IO) {
            val preferences = getSecureSharedPreferences(context)
            val cleanMac = pc.macAddress.replace(":", "").replace("-", "").lowercase()
            val targetId = pc.wakeTargetDeviceId.ifBlank { preferences.getString("wake_target_mac_$cleanMac", "").orEmpty() }
            val enrollment = targetId.takeIf { it.matches(Regex("^[0-9a-f]{32}$")) }
                ?.let { WakeEnrollmentStore(preferences).get(it) }
            if (enrollment != null) {
                val identityStore = WakeIdentityStore(preferences)
                val identity = identityStore.loadOrCreate()
                if (identity is WakeIdentityLoadResult.Ready) {
                    withContext(Dispatchers.Main) { Toast.makeText(context, "Ищем способ включения…", Toast.LENGTH_SHORT).show() }
                    val coordinator = WakeCoordinator(
                        identity = identity.identity,
                        sign = identityStore::sign,
                        localWake = com.example.network.WolUtils::sendMagicPacket,
                        remoteTransport = WakeRelayTransport(OkHttpWakeSocketFactory(okhttp3.OkHttpClient()))
                    )
                    runCatching { coordinator.wake(enrollment, pc.macAddress) }
                    val state = coordinator.state.value[targetId]
                    withContext(Dispatchers.Main) {
                        Toast.makeText(
                            context,
                            when (state?.stage) {
                                WakeStage.ONLINE -> "Компьютер включён"
                                WakeStage.FAILED -> "Не удалось включить: ${state.errorCode}"
                                else -> "Команда отправлена, компьютер запускается"
                            },
                            Toast.LENGTH_LONG
                        ).show()
                    }
                    return@launch
                }
            }
            val result = runCatching { com.example.network.WolUtils.sendMagicPacket(pc.macAddress) }
            withContext(Dispatchers.Main) {
                Toast.makeText(
                    context,
                    if (result.isSuccess) "Команда включения отправлена" else "Не удалось отправить Wake-on-LAN: ${result.exceptionOrNull()?.message}",
                    Toast.LENGTH_SHORT
                ).show()
            }
        }
    }

    wakeTutorialPc?.let { pc ->
        val tutorialPcId = "${pc.hostIp}:${pc.hostPort}"
        WakeOnLanTutorialSheet(
            pcName = pc.hostName,
            includeBridge = true,
            neverShowAgain = dismissWakeTutorial,
            onNeverShowAgainChange = { dismissWakeTutorial = it },
            onDismiss = { wakeTutorialPc = null },
            onWake = {
                if (dismissWakeTutorial) wakeTutorialPreferences.dismiss(tutorialPcId)
                wakeTutorialPc = null
                dismissWakeTutorial = false
                sendLocalWake(pc)
            }
        )
    }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val multicastLock = try {
                wifiManager?.createMulticastLock("AetherUdpMulticastLock")?.apply {
                    setReferenceCounted(true)
                    acquire()
                }
            } catch (e: Exception) {
                e.printStackTrace()
                null
            }
            var socket: DatagramSocket? = null
            val lastUdpMap = mutableMapOf<String, Long>()
            try {
                socket = DatagramSocket(null).apply {
                    reuseAddress = true
                    bind(InetSocketAddress("0.0.0.0", 8081))
                    soTimeout = 2000
                }
                val buffer = ByteArray(2048)
                while (isActive) {
                    val packet = DatagramPacket(buffer, buffer.size)
                    try {
                        receiveDatagramCancellable(socket, packet)
                    } catch (_: SocketTimeoutException) {
                        continue
                    }
                    val text = String(packet.data, 0, packet.length, Charsets.UTF_8)
                    try {
                        val json = JSONObject(text)
                        val advertisedIp = json.optString("ip").trim()
                        val port = json.optInt("port", 8080)
                        val sourceIp = packet.address.hostAddress?.trim().orEmpty()
                        val ip = if (advertisedIp == sourceIp) advertisedIp else sourceIp

                        if (ip.isNotEmpty()) {
                            val now = System.currentTimeMillis()
                            val lastTime = lastUdpMap[ip] ?: 0L
                            if (now - lastTime >= 5000L) {
                                lastUdpMap[ip] = now
                                lastUdpMap.entries.removeIf { now - it.value > 30000L }
                                val verifiedHost = fetchVerifiedHost(context, discoveryClient, ip, port) ?: continue
                                val rawHost = verifiedHost.optString("host", "Unknown PC")
                                val cleanHost = rawHost.replace(Regex("[<>&'\"\\x00-\\x1F]"), "").take(32)
                                val mac = verifiedHost.optString("mac", "")
                                withContext(Dispatchers.Main) {
                                    val exists = savedPcsList.any { it.hostIp == ip }
                                    if (!exists) {
                                        val newPc = SavedPc(
                                            id = "udp_" + System.currentTimeMillis(),
                                            hostName = cleanHost,
                                            hostIp = ip,
                                            hostPort = port,
                                            pin = "",
                                            macAddress = mac,
                                            lastConnected = System.currentTimeMillis(),
                                            isAutoDiscovered = true,
                                            tlsFingerprint = verifiedHost.optString("tlsFingerprint")
                                        )
                                        val updatedList = listOf(newPc) + savedPcsList.filter { it.hostIp != ip }
                                        savedPcsList = updatedList
                                        persistSavedPcs(updatedList)
                                        Toast.makeText(context, "UDP: Найден PC в сети $cleanHost ($ip)", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            }
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                socket?.close()
                multicastLock?.let {
                    if (it.isHeld) {
                        it.release()
                    }
                }
            }
        }
    }

    var ipInput by rememberSaveable { mutableStateOf("") }
    var portInput by rememberSaveable { mutableStateOf("8080") }
    var showManualSettings by rememberSaveable { mutableStateOf(false) }
    var isScanningNetwork by remember { mutableStateOf(false) }
    var showQrScanner by rememberSaveable { mutableStateOf(false) }
    val qrScanGate = remember { PairingQrScanGate() }

    fun performSubnetScan() {
        if (isScanningNetwork) return
        isScanningNetwork = true
        coroutineScope.launch(Dispatchers.IO) {
            val prefixes = getLocalSubnetPrefixes()
            if (prefixes.isEmpty()) {
                withContext(Dispatchers.Main) {
                    isScanningNetwork = false
                    Toast.makeText(context, "Подключитесь к локальной Wi-Fi сети", Toast.LENGTH_SHORT).show()
                }
                return@launch
            }

            val scanSemaphore = Semaphore(16)
            val jobs = prefixes.flatMap { prefix -> (1..254).map { host ->
                async {
                    runCatching {
                        scanSemaphore.withPermit {
                            if (!isActive) return@withPermit null
                            val testIp = "$prefix$host"
                            val verified = fetchVerifiedHost(context, discoveryClient, testIp, 8080) ?: return@withPermit null
                            SavedPc(
                                id = "scan_${System.currentTimeMillis()}_$host",
                                hostName = verified.optString("host", "Aether Computer ($testIp)"),
                                hostIp = testIp,
                                hostPort = 8080,
                                pin = "",
                                macAddress = verified.optString("mac", ""),
                                lastConnected = System.currentTimeMillis(),
                                tlsFingerprint = verified.optString("tlsFingerprint")
                            )
                        }
                    }.getOrNull()
                }
            } }

            val results = jobs.awaitAll().filterNotNull()
            withContext(Dispatchers.Main) {
                isScanningNetwork = false
                if (results.isNotEmpty()) {
                    val updated = results + savedPcsList.filter { existing -> results.none { it.hostIp == existing.hostIp } }
                    savedPcsList = updated
                    persistSavedPcs(updated)
                    Toast.makeText(context, "Найдено ПК в сети: ${results.size}", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(context, "Aether Remote не найден в локальной сети", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    val pinDigitsSaver = remember {
        Saver<SnapshotStateList<String>, String>(
            save = { it.joinToString("|") },
            restore = { saved -> saved.split("|").take(12).let { values -> (values + List(12 - values.size) { "" }).toMutableStateList() } }
        )
    }
    val pinDigits = rememberSaveable(saver = pinDigitsSaver) {
        List(12) { "" }.toMutableStateList()
    }
    val focusRequesters = remember { List(12) { FocusRequester() } }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PitchBlack)
    ) {
        AetherBackdrop(modifier = Modifier.fillMaxSize())
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .zIndex(1f)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(16.dp)
                .size(48.dp)
                .clip(CircleShape)
                .background(GlassWhiteLight)
                .border(1.dp, GlassBorderTopLight, CircleShape)
                .clickable(onClick = onOpenSettings),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Settings,
                contentDescription = "Настройки",
                tint = TextPrimary,
                modifier = Modifier.size(20.dp)
            )
        }
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Spacer(modifier = Modifier.height(if (isCompactHeight) 0.dp else 72.dp))

            LiquidGlassStrongCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = if (isCompactHeight) 12.dp else 26.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (!isCompactHeight) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(GlassWhiteMedium)
                            .border(1.dp, GlassBorderTopLight, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = null,
                            tint = AetherViolet,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(20.dp))
                }

                Text(
                    text = "Установить связь",
                    fontFamily = FontFamily.Serif,
                    fontStyle = FontStyle.Italic,
                    fontSize = if (isCompactHeight) 24.sp else 32.sp,
                    fontWeight = FontWeight.Normal,
                    color = TextPrimary,
                    textAlign = TextAlign.Center
                )

                Spacer(modifier = Modifier.height(if (isCompactHeight) 4.dp else 8.dp))

                Text(
                    text = "Первое подключение — через QR-код на ПК. Для проверенного ПК введите 12-значный код.",
                    fontSize = if (isCompactHeight) 12.sp else 14.sp,
                    fontFamily = FontFamily.SansSerif,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                    lineHeight = if (isCompactHeight) 16.sp else 20.sp
                )

                Spacer(modifier = Modifier.height(if (isCompactHeight) 10.dp else 28.dp))

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (row in 0..1) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            for (i in row * 6 until (row + 1) * 6) {
                                PinBox(
                                    value = pinDigits[i],
                                    focusRequester = focusRequesters[i],
                                    modifier = Modifier.weight(1f),
                                    onValueChange = { newVal ->
                                        if (newVal.length <= 1 && newVal.all { it in '0'..'9' }) {
                                            pinDigits[i] = newVal
                                            if (newVal.isNotEmpty() && i < 11) focusRequesters[i + 1].requestFocus()
                                        }
                                    }
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(if (isCompactHeight) 10.dp else 28.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LiquidGlassButton(
                        onClick = { performSubnetScan() },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 14.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "Найти компьютеры",
                            tint = Color.Cyan,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (isScanningNetwork) "Поиск…" else "Сеть", fontSize = 12.sp, color = TextPrimary, maxLines = 1, softWrap = false)
                    }

                    LiquidGlassButton(
                        onClick = {
                            showQrScanner = !showQrScanner
                            qrScanGate.reset()
                        },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 14.dp)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, contentDescription = "Сканировать QR-код", tint = TextPrimary, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("QR-код", fontSize = 12.sp, color = TextPrimary, maxLines = 1, softWrap = false)
                    }

                    LiquidGlassButton(
                        onClick = { showManualSettings = !showManualSettings },
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 14.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Settings,
                            contentDescription = "Ручной ввод адреса",
                            tint = TextPrimary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("IP/порт", fontSize = 12.sp, color = TextPrimary, maxLines = 1, softWrap = false)
                    }
                }

                AnimatedVisibility(
                    visible = showQrScanner,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    InlineQrScanner(
                        onDecoded = { raw ->
                            when (val decision = qrScanGate.consume(raw, System.currentTimeMillis())) {
                                is PairingQrScanDecision.Accepted -> {
                                    showQrScanner = false
                                    val usesRemoteOverride = showManualSettings && ipInput.isNotBlank()
                                    val payload = decision.payload.withRemoteEndpoint(
                                        if (usesRemoteOverride) ipInput else "",
                                        portInput
                                    )
                                    if (payload == null) {
                                        Toast.makeText(context, "Проверьте VPN-адрес и порт", Toast.LENGTH_SHORT).show()
                                        return@InlineQrScanner
                                    }
                                    if (usesRemoteOverride) {
                                        val remotePc = SavedPc(
                                            id = "remote_${System.currentTimeMillis()}",
                                            hostName = "Computer (${payload.host})",
                                            hostIp = payload.host,
                                            hostPort = payload.port,
                                            pin = "",
                                            lastConnected = System.currentTimeMillis(),
                                            tlsFingerprint = payload.tlsFingerprint.orEmpty()
                                        )
                                        val updated = listOf(remotePc) + savedPcsList.filter { it.hostIp != payload.host }
                                        savedPcsList = updated
                                        persistSavedPcs(updated)
                                    }
                                    onConnect(payload.host, payload.port, payload.pin, false, payload.tlsFingerprint)
                                }
                                PairingQrScanDecision.Invalid -> {
                                    val message = if (raw.startsWith("aether://", ignoreCase = true)) {
                                        "Этот QR-код Aether Remote устарел. Обновите приложение на ПК"
                                    } else {
                                        "QR-код не относится к Aether Remote"
                                    }
                                    Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
                                }
                                PairingQrScanDecision.Ignored -> Unit
                            }
                        },
                        onClose = {
                            showQrScanner = false
                            qrScanGate.reset()
                        },
                        modifier = Modifier.padding(top = 14.dp)
                    )
                }

                AnimatedVisibility(
                    visible = showManualSettings,
                    enter = fadeIn() + expandVertically(),
                    exit = fadeOut() + shrinkVertically()
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 16.dp)
                    ) {
                        Text(
                            "Для первого входа через VPN укажите VPN-адрес, затем отсканируйте QR с компьютера.",
                            color = TextMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        OutlinedTextField(
                            value = ipInput,
                            onValueChange = { ipInput = it },
                            label = { Text("IP или имя хоста") },
                            placeholder = { Text("192.168.1.50 или pc.example.net") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary,
                                focusedBorderColor = GlassBorderTopLight,
                                unfocusedBorderColor = GlassWhiteMedium
                            )
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = portInput,
                            onValueChange = { portInput = it },
                            label = { Text("Порт (По умолчанию 8080)") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary,
                                focusedBorderColor = GlassBorderTopLight,
                                unfocusedBorderColor = GlassWhiteMedium
                            )
                        )
                    }
                }

                Spacer(modifier = Modifier.height(if (isCompactHeight) 10.dp else 28.dp))

                LiquidGlassButton(
                    onClick = {
                        val pin = pinDigits.joinToString("")
                        val port = portInput.toIntOrNull() ?: 8080
                        var targetIp = ipInput.trim()
                        if (pin.length != 12 || !pin.all { it.isDigit() }) {
                            Toast.makeText(context, "Введите все 12 цифр кода подключения", Toast.LENGTH_SHORT).show()
                            return@LiquidGlassButton
                        }
                        val finalPin = pin

                        if (!showManualSettings) targetIp = ""

                        if (targetIp.isNotEmpty()) {
                            targetIp = remoteHostOrNull(targetIp).orEmpty()
                            if (targetIp.isEmpty()) {
                                Toast.makeText(context, "Укажите корректный IP или имя хоста", Toast.LENGTH_SHORT).show()
                                return@LiquidGlassButton
                            }
                            val existing = savedPcsList.filter { it.hostIp != targetIp }
                            val newPc = SavedPc(
                                id = System.currentTimeMillis().toString(),
                                hostName = if (targetIp == "127.0.0.1") "Localhost" else "Computer ($targetIp)",
                                hostIp = targetIp,
                                hostPort = port,
                                pin = "",
                                lastConnected = System.currentTimeMillis()
                            )
                            val updated = listOf(newPc) + existing
                            savedPcsList = updated
                            persistSavedPcs(updated)
                        }

                        onConnect(targetIp, port, finalPin, false, null)
                    },
                    isStrong = true,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = "Подключиться к ПК",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                        tint = AetherViolet,
                        modifier = Modifier.size(18.dp)
                    )
                }

            }
        }

        val visibleSavedPcs = savedPcsList.filter { saved ->
            accountHosts.none { host ->
                (!host.lanIp.isNullOrBlank() && host.lanIp == saved.hostIp && host.port == saved.hostPort) ||
                    (!host.tlsFingerprint.isNullOrBlank() &&
                        normalizeTlsFingerprint(host.tlsFingerprint) == normalizeTlsFingerprint(saved.tlsFingerprint))
            }
        }
        if (accountHosts.isNotEmpty() || visibleSavedPcs.isNotEmpty()) {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "Компьютеры (${accountHosts.size + visibleSavedPcs.size})",
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = TextSecondary,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
                textAlign = TextAlign.Start
            )
            Spacer(modifier = Modifier.height(8.dp))
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                accountHosts.forEach { host ->
                    AccountComputerCard(host = host, onConnect = { onConnectAccountHost(host) })
                }
                visibleSavedPcs.forEach { pc ->
                    SavedComputerCard(
                        pc = pc,
                        onConnect = {
                            val fingerprint = normalizeTlsFingerprint(pc.tlsFingerprint)
                                ?: tlsPinStore.get(pc.hostIp, pc.hostPort)
                            val hasSavedSession = fingerprint != null && !getSecureSharedPreferences(context)
                                .getString(guestSessionTokenPreferenceKey(pc.hostIp, pc.hostPort, fingerprint), "")
                                .isNullOrBlank()
                            if (hasSavedSession) {
                                onConnect(pc.hostIp, pc.hostPort, "", false, pc.tlsFingerprint.ifBlank { null })
                            } else {
                                ipInput = pc.hostIp
                                portInput = pc.hostPort.toString()
                                showManualSettings = true
                                Toast.makeText(context, "Введите код с экрана ПК", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onWake = {
                            if (wakeTutorialPreferences.isDismissed("${pc.hostIp}:${pc.hostPort}")) {
                                sendLocalWake(pc)
                            } else {
                                dismissWakeTutorial = false
                                wakeTutorialPc = pc
                            }
                        },
                        onHelp = {
                            dismissWakeTutorial = wakeTutorialPreferences.isDismissed("${pc.hostIp}:${pc.hostPort}")
                            wakeTutorialPc = pc
                        },
                        onDelete = {
                            val fingerprint = normalizeTlsFingerprint(pc.tlsFingerprint)
                                ?: tlsPinStore.get(pc.hostIp, pc.hostPort)
                            val updated = savedPcsList.filter { it.id != pc.id }
                            savedPcsList = updated
                            persistSavedPcs(updated)
                            tlsPinStore.remove(pc.hostIp, pc.hostPort)
                            val editor = getSecureSharedPreferences(context).edit().remove("token_${pc.hostIp}")
                            fingerprint?.let {
                                editor.remove(guestSessionTokenPreferenceKey(pc.hostIp, pc.hostPort, it))
                            }
                            editor.apply()
                        }
                    )
                }
            }
        }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }



}

@Composable
internal fun AccountComputerCard(
    host: AccountDevice,
    onConnect: () -> Unit
) {
    LiquidGlassCard(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(38.dp).background(AetherViolet.copy(alpha = 0.16f), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Cloud, contentDescription = null, tint = AetherViolet, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = host.name,
                        color = TextPrimary,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    Spacer(Modifier.width(6.dp))
                    ComputerBadge("АККАУНТ", AetherViolet)
                }
                Text(
                    text = host.lanIp?.let { "$it:${host.port}" } ?: "Привязан к вашему аккаунту",
                    color = TextMuted,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            Spacer(Modifier.width(8.dp))
            LiquidGlassButton(
                onClick = onConnect,
                shape = RoundedCornerShape(12.dp),
                contentPadding = PaddingValues(horizontal = 11.dp, vertical = 10.dp)
            ) {
                Text("Открыть", color = TextPrimary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(4.dp))
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = AetherViolet, modifier = Modifier.size(15.dp))
            }
        }
    }
}

@Composable
internal fun SavedComputerCard(
    pc: SavedPc,
    onConnect: () -> Unit,
    onWake: () -> Unit,
    onHelp: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    LiquidGlassCard(modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(36.dp).background(Color(0xFF22C55E).copy(alpha = 0.13f), RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Computer, contentDescription = null, tint = Color(0xFF22C55E), modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = pc.hostName,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextPrimary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        if (pc.isAutoDiscovered || pc.id.startsWith("udp_")) {
                            Spacer(Modifier.width(6.dp))
                            ComputerBadge("СЕТЬ", Color.Cyan)
                        }
                    }
                    Text(
                        text = "${pc.hostIp}:${pc.hostPort}",
                        fontSize = 10.sp,
                        color = TextMuted,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                LiquidGlassButton(
                    onClick = onConnect,
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp)
                ) {
                    Text("Подключить", color = TextPrimary, fontSize = 10.sp, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.width(5.dp))
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = AetherViolet, modifier = Modifier.size(15.dp))
                }
                ComputerActionButton(Icons.Default.PowerSettingsNew, "Включить компьютер", Color.Cyan, onWake)
                ComputerActionButton(Icons.Default.HelpOutline, "Инструкция Wake-on-LAN", TextMuted, onHelp)
                ComputerActionButton(Icons.Default.Delete, "Удалить компьютер", Color(0xFFF43F5E), onDelete)
            }
        }
    }
}

@Composable
private fun ComputerBadge(text: String, color: Color) {
    Text(
        text = text,
        color = color,
        fontSize = 8.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.background(color.copy(alpha = 0.13f), RoundedCornerShape(5.dp)).padding(horizontal = 5.dp, vertical = 2.dp)
    )
}

@Composable
private fun ComputerActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    tint: Color,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(GlassWhiteLight)
            .border(1.dp, GlassBorderTopLight, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(18.dp))
    }
}

@Composable
private fun PinBox(
    value: String,
    focusRequester: FocusRequester,
    modifier: Modifier = Modifier,
    onValueChange: (String) -> Unit
) {
    Box(
        modifier = modifier
            .height(46.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(GlassWhiteUltraThin)
            .border(
                width = 1.dp,
                color = if (value.isNotEmpty()) GlassBorderTopLight else GlassWhiteMedium,
                shape = RoundedCornerShape(12.dp)
            ),
        contentAlignment = Alignment.Center
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .focusRequester(focusRequester)
                .fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            textStyle = TextStyle(
                color = TextPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            ),
            cursorBrush = SolidColor(TextPrimary)
        )
    }
}
