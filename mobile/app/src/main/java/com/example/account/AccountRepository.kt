package com.example.account

import com.example.BuildConfig

import android.content.Context
import android.net.Uri
import com.example.data.AetherPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

data class AccountProfile(val id: String, val email: String)
data class AccountDevice(
    val id: String, val ownerId: String, val kind: String, val name: String,
    val publicKeySpki: String, val tlsFingerprint: String?, val lanIp: String?, val port: Int,
    val lastSeenAt: String, val revoked: Boolean, val networkEndpoints: List<String> = emptyList()
)

private fun isSafeIpv4Endpoint(value: String): Boolean {
    val parts = value.split('.')
    if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || it.any { char -> !char.isDigit() } }) return false
    val octets = parts.map { it.toIntOrNull() ?: return false }
    if (octets.any { it !in 0..255 }) return false
    return octets[0] in 1..223 && octets[0] != 127 && !(octets[0] == 169 && octets[1] == 254)
}

internal fun accountEndpointCandidates(host: AccountDevice): List<String> =
    (listOfNotNull(host.lanIp) + host.networkEndpoints).filter(::isSafeIpv4Endpoint).distinct().take(16)
data class AccountState(
    val profile: AccountProfile? = null,
    val devices: List<AccountDevice> = emptyList(),
    val busy: Boolean = false,
    val offline: Boolean = false,
    val persistent: Boolean = true,
    val message: String? = null,
    val passwordRecovery: Boolean = false
)

class AccountRepository(context: Context) {
    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val operation = Mutex()
    private val refreshLock = Mutex()
    private val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS).build()
    private val _state = MutableStateFlow(AccountState())
    val state = _state.asStateFlow()
    private var session: JSONObject? = null
    private var identity: AccountIdentity? = null
    private var secure: AetherPreferences.Result? = null
    private var poll: Job? = null
    private var foreground = true
    @Volatile private var accountEpoch = 0L

    private val initialized: Job = scope.launch {
            try {
                secure = AetherPreferences.secureWithStatus(appContext)
                identity = AccountIdentity.loadOrCreate()
                _state.value = _state.value.copy(persistent = secure!!.persistent)
                val cached = secure!!.preferences.getString(SESSION_KEY, null)
                if (cached != null) {
                    val json = JSONObject(cached)
                    refreshLock.withLock { acceptSession(json) }
                    syncDirectory()
                }
            } catch (_: Exception) {
                _state.value = _state.value.copy(offline = true, message = "Не удалось восстановить аккаунт. Проверьте интернет или войдите заново.")
            }
            startPolling()
    }

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null,
                                bearer: String? = null, extra: Map<String, String> = emptyMap()): String = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(BASE_URL + path).header("apikey", PUBLIC_KEY)
        if (bearer != null) builder.header("Authorization", "Bearer $bearer")
        extra.forEach { (key, value) -> builder.header(key, value) }
        builder.method(method, if (method in setOf("GET", "HEAD")) null else
            (body?.toString() ?: "{}").toRequestBody("application/json".toMediaType()))
        client.newCall(builder.build()).execute().use { response ->
            if ((response.body?.contentLength() ?: 0) > 2 * 1024 * 1024) throw AccountFailure("response_too_large")
            val source = response.body?.source() ?: throw AccountFailure("empty_response")
            if (source.request(2L * 1024 * 1024 + 1)) throw AccountFailure("response_too_large")
            val text = source.readUtf8()
            if (!response.isSuccessful) {
                val code = runCatching { JSONObject(text).optString("error_code") }.getOrDefault("")
                throw AccountFailure(if (code.isNotEmpty()) code else "http_${response.code}")
            }
            text
        }
    }

    private class AccountFailure(val code: String) : Exception("account_request_failed")
    private fun message(error: Exception): String = when ((error as? AccountFailure)?.code) {
        "invalid_credentials" -> "Неверная почта или пароль."
        "email_not_confirmed" -> "Подтвердите почту по письму перед входом."
        "over_email_send_rate_limit", "over_request_rate_limit", "http_429" -> "Слишком много попыток. Попробуйте позже."
        "invalid_input" -> "Проверьте почту и пароль: минимум 8 символов."
        "invalid_callback" -> "Ссылка входа устарела. Начните вход заново."
        "device_revoked" -> "Это устройство отозвано. Создайте новую идентичность через сброс аккаунта на устройстве."
        else -> "Не удалось связаться с аккаунтом. Проверьте интернет и попробуйте ещё раз."
    }

    private suspend fun acceptSession(json: JSONObject) {
        val access = json.getString("access_token")
        val refresh = json.getString("refresh_token")
        require(access.length in 20..16384 && refresh.length in 8..4096)
        val user = json.getJSONObject("user")
        val id = user.getString("id")
        require(Regex("^[0-9a-f-]{36}$").matches(id))
        if (!json.has("expires_at")) json.put("expires_at", System.currentTimeMillis() / 1000 + json.getLong("expires_in"))
        val prefs = secure ?: AetherPreferences.secureWithStatus(appContext).also { secure = it }
        if (!prefs.preferences.edit().putString(SESSION_KEY, json.toString()).commit()) throw AccountFailure("storage_failed")
        session = json
        var devices = _state.value.devices
        if (_state.value.profile?.id != id) {
            accountEpoch++
            devices = runCatching {
                val array = JSONArray(prefs.preferences.getString("account_devices_$id", "[]"))
                (0 until array.length()).map { parseDevice(array.getJSONObject(it)) }.filter { it.ownerId == id }
            }.getOrDefault(emptyList())
        }
        _state.value = _state.value.copy(profile = AccountProfile(id, user.optString("email")), devices = devices, offline = false, message = null)
    }

    suspend fun accessToken(): String = refreshLock.withLock {
        val current = session ?: throw AccountFailure("signed_out")
        if (current.getLong("expires_at") <= System.currentTimeMillis() / 1000 + 60) {
            val refreshed = JSONObject(request("/auth/v1/token?grant_type=refresh_token", "POST",
                JSONObject().put("refresh_token", current.getString("refresh_token"))))
            acceptSession(refreshed)
        }
        session!!.getString("access_token")
    }

    private fun validate(email: String, password: String) {
        if (email.length > 254 || !Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email.trim()) ||
            password.length !in 8..1024) throw AccountFailure("invalid_input")
    }

    private fun perform(waitForLock: Boolean = false, block: suspend () -> Unit) {
        scope.launch {
            initialized.join()
            if (waitForLock) operation.lock() else if (!operation.tryLock()) return@launch
            _state.value = _state.value.copy(busy = true, message = null)
            try { block() } catch (error: Exception) { _state.value = _state.value.copy(message = message(error)) }
            finally { _state.value = _state.value.copy(busy = false); operation.unlock() }
        }
    }

    fun signIn(email: String, password: String) = perform {
        validate(email, password)
        val signedIn = JSONObject(request("/auth/v1/token?grant_type=password", "POST",
            JSONObject().put("email", email.trim()).put("password", password)))
        refreshLock.withLock { acceptSession(signedIn) }
        syncDirectory()
    }

    private suspend fun pkce(recovery: Boolean = false): Pair<String, JSONObject> {
        val verifier = AccountProtocol.base64Url(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val nonce = AccountProtocol.base64Url(ByteArray(24).also { SecureRandom().nextBytes(it) })
        val challenge = AccountProtocol.base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val pending = JSONObject().put("verifier", verifier).put("state", nonce)
            .put("expiresAt", System.currentTimeMillis() + 30 * 60_000).put("recovery", recovery)
        val prefs = secure ?: AetherPreferences.secureWithStatus(appContext).also { secure = it }
        if (!prefs.preferences.edit().putString(PKCE_KEY, pending.toString()).commit()) throw AccountFailure("storage_failed")
        val redirect = "aetherremote://auth/callback?state=$nonce"
        return redirect to JSONObject().put("code_challenge", challenge).put("code_challenge_method", "s256")
    }

    fun signUp(email: String, password: String) = perform {
        validate(email, password)
        val (redirect, body) = pkce()
        val result = JSONObject(request("/auth/v1/signup?redirect_to=${Uri.encode(redirect)}", "POST",
            body.put("email", email.trim()).put("password", password)))
        if (result.has("access_token")) { refreshLock.withLock { acceptSession(result) }; syncDirectory() }
        else _state.value = _state.value.copy(message = "Если регистрация доступна, письмо отправлено. Откройте его на этом телефоне.")
    }

    fun recover(email: String) = perform {
        validate(email, "validation-only")
        val (redirect, body) = pkce(recovery = true)
        request("/auth/v1/recover?redirect_to=${Uri.encode(redirect)}", "POST", body.put("email", email.trim()))
        _state.value = _state.value.copy(message = "Если аккаунт существует, письмо отправлено. Откройте его на этом телефоне.")
    }

    fun updatePassword(password: String) = perform {
        if (password.length !in 8..1024 || !_state.value.passwordRecovery) throw AccountFailure("invalid_input")
        request("/auth/v1/user", "PUT", JSONObject().put("password", password), accessToken())
        _state.value = _state.value.copy(passwordRecovery = false, message = "Пароль изменён. Ранее доверенные устройства можно отозвать отдельно.")
    }

    fun reportError(error: Exception) { _state.value = _state.value.copy(message = message(error)) }

    fun handleCallback(uri: Uri) = perform {
        if (uri.scheme != "aetherremote" || uri.host != "auth" || uri.path != "/callback" || uri.fragment != null) throw AccountFailure("invalid_callback")
        val prefs = secure ?: AetherPreferences.secureWithStatus(appContext).also { secure = it }
        val pending = JSONObject(prefs.preferences.getString(PKCE_KEY, null) ?: throw AccountFailure("invalid_callback"))
        if (pending.getLong("expiresAt") <= System.currentTimeMillis() || uri.getQueryParameter("state") != pending.getString("state")) throw AccountFailure("invalid_callback")
        val code = uri.getQueryParameter("code") ?: throw AccountFailure("invalid_callback")
        if (code.length !in 1..4096) throw AccountFailure("invalid_callback")
        prefs.preferences.edit().remove(PKCE_KEY).commit()
        val signedIn = JSONObject(request("/auth/v1/token?grant_type=pkce", "POST",
            JSONObject().put("auth_code", code).put("code_verifier", pending.getString("verifier"))))
        refreshLock.withLock { acceptSession(signedIn) }
        _state.value = _state.value.copy(passwordRecovery = pending.optBoolean("recovery"))
        syncDirectory()
    }

    suspend fun deviceIdentity(): AccountIdentity = withContext(Dispatchers.IO) {
        identity ?: AccountIdentity.loadOrCreate().also { identity = it }
    }

    suspend fun syncDirectory() {
        val token = accessToken()
        val owner = session!!.getJSONObject("user").getString("id")
        val key = deviceIdentity()
        val rows = JSONArray(request("/rest/v1/aether_devices?owner_id=eq.$owner&select=*&limit=256", bearer = token))
        val cloudDevices = (0 until rows.length()).map { parseDevice(rows.getJSONObject(it)) }
        require(cloudDevices.all { it.ownerId == owner })
        val revocations = AccountRevocations(secure!!.preferences, owner)
        revocations.merge(cloudDevices)
        val devices = cloudDevices.map { it.copy(revoked = it.revoked || revocations.contains(it.id)) }
        secure?.preferences?.edit()?.putString("account_devices_$owner", rows.toString())?.commit()
        _state.value = _state.value.copy(devices = devices)
        for (id in revocations.pending()) {
            request("/rest/v1/aether_devices?owner_id=eq.$owner&id=eq.$id&revoked_at=is.null", "PATCH",
                JSONObject().put("revoked_at", timestamp()), token)
            revocations.acknowledge(id)
        }
        val own = devices.find { it.id == key.id }
        if (own?.revoked == true) throw AccountFailure("device_revoked")
        if (own == null) {
            request("/rest/v1/aether_devices", "POST", JSONObject().put("owner_id", owner).put("id", key.id)
                .put("kind", "phone").put("name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(80))
                .put("public_key_spki", key.publicKeySpki), token)
        } else {
            request("/rest/v1/aether_devices?owner_id=eq.$owner&id=eq.${key.id}&revoked_at=is.null", "PATCH",
                JSONObject().put("last_seen_at", timestamp()), token)
        }
        _state.value = _state.value.copy(devices = devices, offline = false)
    }

    suspend fun prepareConnection(host: AccountDevice): AccountConnection = withContext(Dispatchers.IO) {
        initialized.join()
        operation.withLock {
            val owner = _state.value.profile?.id ?: throw AccountFailure("signed_out")
            require(host.ownerId == owner && host.kind == "host" && !host.revoked)
            val epoch = accountEpoch
            val identity = deviceIdentity()
            val prefs = secure!!.preferences
            val revocations = AccountRevocations(prefs, owner)
            if (revocations.contains(host.id) || revocations.contains(identity.id)) throw AccountFailure("device_revoked")
            val stored = prefs.getString("account_grant_${owner}_${host.id}", null)
            var grant = runCatching { stored?.let { AccountGrant.fromJson(JSONObject(it)) } }.getOrNull()
                ?.takeIf { AccountProtocol.verifyGrant(it, host.publicKeySpki) && it.phoneId == identity.id && it.ownerId == owner &&
                    it.hostId == host.id && it.hostTlsFingerprint == host.tlsFingerprint }
            val token = runCatching { accessToken() }.getOrNull()
            if (token != null) {
                try {
                    syncDirectory()
                    require(_state.value.devices.none { (it.id == host.id || it.id == identity.id) && it.revoked })
                    val rows = JSONArray(request("/rest/v1/aether_grants?owner_id=eq.$owner&host_id=eq.${host.id}&phone_id=eq.${identity.id}&select=*&limit=2048", bearer = token))
                    if (grant != null && (0 until rows.length()).any { index ->
                        val row = rows.getJSONObject(index)
                        row.getString("id") == grant!!.grantId && !row.isNull("revoked_at")
                    }) {
                        prefs.edit().remove("account_grant_${owner}_${host.id}").commit()
                        grant = null
                    }
                } catch (failure: IllegalArgumentException) { throw failure }
                catch (failure: AccountFailure) { if (failure.code == "device_revoked") throw failure }
                catch (_: java.io.IOException) { _state.value = _state.value.copy(offline = true) }
            }
            if (grant == null && (token == null || _state.value.offline)) throw AccountFailure("cloud_required")
            val currentHost = _state.value.devices.firstOrNull { it.id == host.id && it.kind == "host" } ?: host
            AccountConnection(currentHost, identity, grant, token, onGrant = { accepted ->
                require(epoch == accountEpoch && _state.value.profile?.id == owner &&
                    !revocations.contains(host.id) && !revocations.contains(identity.id) &&
                    accepted.ownerId == owner && accepted.hostId == host.id && accepted.phoneId == identity.id &&
                    AccountProtocol.verifyGrant(accepted, host.publicKeySpki))
                if (!prefs.edit().putString("account_grant_${owner}_${host.id}", accepted.toJson().toString()).commit()) {
                    throw AccountFailure("storage_failed")
                }
            }, openRelay = if (RELAY_URL.isBlank()) null else ({ prepareRelay(currentHost) }),
                refresh = { prepareConnection(currentHost) })
        }
    }

    private suspend fun prepareRelay(host: AccountDevice): AccountConnection {
        val epoch = accountEpoch
        val connection = prepareConnection(host)
        val token = accessToken()
        require(epoch == accountEpoch && _state.value.profile?.id == host.ownerId && !_state.value.offline)
        request("/rest/v1/aether_sessions", "POST", JSONObject().put("owner_id", host.ownerId)
            .put("id", connection.sessionId).put("host_id", host.id).put("phone_id", connection.identity.id), token)
        val sessionPath = "/rest/v1/aether_sessions?owner_id=eq.${host.ownerId}&id=eq.${connection.sessionId}"
        val bridge = AccountRelayBridge.open(
            client,
            RELAY_URL,
            host.ownerId,
            connection.sessionId,
            connection.identity,
            token
        ) {
            scope.launch {
                runCatching { request(sessionPath, "PATCH", JSONObject().put("state", "closed"), token) }
            }
        }
        try {
            request(sessionPath, "PATCH", JSONObject().put("state", "accepted"), token)
        } catch (error: Exception) {
            bridge.close()
            throw error
        }
        if (epoch != accountEpoch || _state.value.profile?.id != host.ownerId) {
            bridge.close()
            throw AccountFailure("signed_out")
        }
        return AccountConnection(connection.host, connection.identity, connection.grant, token, connection.onGrant,
            connection.sessionId, bridge = bridge, refresh = { prepareConnection(connection.host) })
    }

    fun refresh() = perform { syncDirectory() }

    fun rename(id: String, name: String) = perform {
        require(Regex("^[0-9a-f]{64}$").matches(id) && name.trim().length in 1..80)
        val owner = _state.value.profile?.id ?: throw AccountFailure("signed_out")
        request("/rest/v1/aether_devices?owner_id=eq.$owner&id=eq.$id&revoked_at=is.null", "PATCH",
            JSONObject().put("name", name.trim()), accessToken())
        syncDirectory()
    }

    fun revoke(id: String) = perform {
        require(Regex("^[0-9a-f]{64}$").matches(id))
        val owner = _state.value.profile?.id ?: throw AccountFailure("signed_out")
        AccountRevocations(secure!!.preferences, owner).revoke(id)
        _state.value = _state.value.copy(devices = _state.value.devices.map { if (it.id == id) it.copy(revoked = true) else it })
        syncDirectory()
    }

    fun signOut() {
        accountEpoch++
        // Logout must not wait for an in-flight directory request to reach its network timeout.
        client.dispatcher.cancelAll()
        perform(waitForLock = true) {
            val access = refreshLock.withLock {
                val token = session?.optString("access_token")
                session = null
                val prefs = secure?.preferences
                val editor = prefs?.edit()?.remove(SESSION_KEY)?.remove(PKCE_KEY)
                prefs?.all?.keys?.filter { it.startsWith("account_grant_") || it.startsWith("account_devices_") }
                    ?.forEach { editor?.remove(it) }
                editor?.commit()
                _state.value = AccountState(persistent = secure?.persistent ?: false)
                token
            }
            if (!access.isNullOrEmpty()) runCatching {
                request("/auth/v1/logout?scope=local", "POST", bearer = access)
            }
        }
    }

    fun setForeground(active: Boolean) {
        foreground = active
        if (active) startPolling() else { poll?.cancel(); poll = null }
    }

    @Synchronized
    private fun startPolling() {
        if (!foreground || poll?.isActive == true) return
        poll = scope.launch {
            while (true) {
                delay(45_000)
                if (session != null && operation.tryLock()) {
                    try { syncDirectory() } catch (_: Exception) { _state.value = _state.value.copy(offline = true) }
                    finally { operation.unlock() }
                }
            }
        }
    }

    fun destroy() { scope.cancel(); client.dispatcher.cancelAll(); client.connectionPool.evictAll() }

    companion object {
        const val BASE_URL = "https://lihklgocvacchmoirosg.supabase.co"
        const val PUBLIC_KEY = "sb_publishable_SRfRkItYH9bE0q5f6pnolw_zGphWNeE"
        val RELAY_URL: String = BuildConfig.ACCOUNT_RELAY_URL
        private const val SESSION_KEY = "account_session_v1"
        private const val PKCE_KEY = "account_pkce_v1"
        private fun timestamp(): String = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())

        fun parseDevice(row: JSONObject): AccountDevice {
            val spki = row.getString("public_key_spki")
            val id = row.getString("id")
            val kind = row.getString("kind")
            val owner = row.getString("owner_id")
            val name = row.getString("name")
            val pin = if (row.isNull("tls_fingerprint")) null else row.getString("tls_fingerprint")
            require(AccountProtocol.deviceId(spki) == id && kind in setOf("host", "phone") &&
                Regex("^[0-9a-f-]{36}$").matches(owner) && name.trim().length in 1..80 &&
                (kind != "host" || pin?.matches(Regex("^[0-9a-f]{64}$")) == true))
            val port = row.getInt("port")
            require(port in 1..65535)
            val endpoints = if (row.has("network_endpoints") && !row.isNull("network_endpoints")) {
                val array = row.getJSONArray("network_endpoints")
                require(array.length() <= 16)
                (0 until array.length()).map { array.getString(it) }.also { values ->
                    require(values.all(::isSafeIpv4Endpoint))
                }.distinct()
            } else emptyList()
            return AccountDevice(id, owner, kind, name, spki, pin,
                if (row.isNull("lan_ip")) null else row.getString("lan_ip"), port, row.getString("last_seen_at"),
                !row.isNull("revoked_at"), endpoints)
        }
    }
}
