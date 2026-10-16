package com.example.network

import android.annotation.SuppressLint
import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager
import javax.net.ssl.SSLContext
import okhttp3.OkHttpClient

private val TLS_FINGERPRINT_PATTERN = Regex("^SHA256:[A-F0-9]{64}$")

internal fun normalizeTlsFingerprint(value: String?): String? {
    val normalized = value?.trim()?.uppercase()?.replace(":", "")?.let { raw ->
        if (raw.startsWith("SHA256")) "SHA256:${raw.removePrefix("SHA256")}" else "SHA256:$raw"
    } ?: return null
    return normalized.takeIf(TLS_FINGERPRINT_PATTERN::matches)
}

internal fun guestSessionTokenPreferenceKey(host: String, port: Int, fingerprint: String): String {
    require(port in 1..65535) { "Некорректный порт" }
    val normalizedHost = host.trim().trimEnd('.').lowercase()
    require(normalizedHost.isNotEmpty()) { "Некорректный адрес хоста" }
    val normalizedFingerprint = requireNotNull(normalizeTlsFingerprint(fingerprint)) {
        "Некорректный TLS-отпечаток"
    }
    val identity = "$normalizedHost\u0000$port\u0000$normalizedFingerprint"
    val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
    return "guest_token_v2_" + digest.joinToString("") { "%02x".format(it) }
}

internal fun certificateSha256Fingerprint(certificate: X509Certificate): String =
    "SHA256:" + MessageDigest.getInstance("SHA-256")
        .digest(certificate.encoded)
        .joinToString("") { "%02X".format(it) }

internal fun requireMatchingTlsFingerprint(expected: String?, actual: String) {
    if (expected == null) {
        throw CertificateException("Для первого подключения отсканируйте QR-код на ПК")
    }
    val normalizedActual = normalizeTlsFingerprint(actual)
        ?: throw CertificateException("Некорректный отпечаток сертификата хоста")
    val normalizedExpected = normalizeTlsFingerprint(expected)
    if (normalizedExpected == null) {
        throw CertificateException("Некорректный сохранённый TLS-отпечаток")
    }
    if (normalizedExpected != normalizedActual) {
        throw CertificateException("Сертификат ПК изменился. Возможна подмена соединения")
    }
}

internal class TlsPinStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("aether_tls_pins", Context.MODE_PRIVATE)

    fun get(host: String, port: Int): String? = normalizeTlsFingerprint(preferences.getString(key(host, port), null))

    fun save(host: String, port: Int, fingerprint: String) {
        val normalized = requireNotNull(normalizeTlsFingerprint(fingerprint)) { "Некорректный TLS-отпечаток" }
        check(preferences.edit().putString(key(host, port), normalized).commit()) { "Не удалось сохранить TLS-отпечаток" }
    }

    fun remove(host: String, port: Int) {
        preferences.edit().remove(key(host, port)).apply()
    }

    private fun key(host: String, port: Int) = "${host.trim().lowercase()}:$port"
}

// Certificate authority validation is intentionally replaced by an exact persisted SHA-256 pin for the host's self-signed LAN identity.
@SuppressLint("CustomX509TrustManager")
internal class TofuTlsTrustManager(
    expectedFingerprint: String?,
    private val onPeerVerified: (String) -> Unit,
    private val allowUnpinnedDiscovery: Boolean = false
) : X509TrustManager {
    private val expected = expectedFingerprint

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("Client certificates are not accepted")

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("Сервер не предоставил сертификат")
        leaf.checkValidity()
        val actual = certificateSha256Fingerprint(leaf)
        if (expected != null || !allowUnpinnedDiscovery) requireMatchingTlsFingerprint(expected, actual)
        if (expected == null) {
            try {
                leaf.verify(leaf.publicKey)
            } catch (error: Exception) {
                throw CertificateException("Первичное подключение разрешено только к самоподписанному сертификату Aether", error)
            }
        }
        onPeerVerified(actual)
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

}

internal fun buildTofuTlsClient(
    baseClient: OkHttpClient,
    expectedFingerprint: String?,
    onPeerVerified: (String) -> Unit,
    allowUnpinnedDiscovery: Boolean = false,
    allowRelayLoopback: Boolean = false
): OkHttpClient {
    val trustManager = TofuTlsTrustManager(expectedFingerprint, onPeerVerified, allowUnpinnedDiscovery)
    val sslContext = SSLContext.getInstance("TLS").apply {
        init(null, arrayOf(trustManager), SecureRandom())
    }
    return baseClient.newBuilder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        .hostnameVerifier { hostname, _ -> remoteHostOrNull(hostname) != null ||
            (allowRelayLoopback && expectedFingerprint != null && hostname == "127.0.0.1") }
        .build()
}
