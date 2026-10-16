package com.example.aetherdeck

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

class DeckAssetCache(context: Context) {
    private companion object {
        const val MAX_ASSET_BYTES = 8 * 1024 * 1024
        const val MAX_ASSET_CHUNK_BASE64_CHARS = 512 * 1024
        const val MAX_ASSET_CHUNKS = 128
        const val MAX_PENDING_ASSETS = 16
        const val MAX_PENDING_BYTES = 16 * 1024 * 1024
        const val MAX_CACHE_ASSETS = 32
        const val MAX_CACHE_BYTES = 32L * 1024 * 1024
        val HASH_PATTERN = Regex("^[a-f0-9]{64}$")
        val IMAGE_MIME_TYPES = setOf("image/png", "image/jpeg", "image/gif", "image/svg+xml", "image/webp")
    }

    private val directory = File(context.cacheDir, "aether-deck-assets").apply { mkdirs() }
    private data class Pending(val mimeType: String, val chunks: Array<ByteArray?>, var receivedBytes: Int = 0)
    private val pending = mutableMapOf<String, Pending>()

    init {
        cleanupOrphans()
        enforceCacheBudget(0, null)
    }

    fun contains(hash: String): Boolean = HASH_PATTERN.matches(hash) && file(hash).exists()
    @Synchronized
    fun read(hash: String): ByteArray? {
        if (!HASH_PATTERN.matches(hash)) return null
        val asset = file(hash).takeIf { it.isFile && it.length() in 1..MAX_ASSET_BYTES.toLong() } ?: return null
        asset.setLastModified(System.currentTimeMillis())
        return asset.readBytes()
    }
    @Synchronized
    fun clear() { directory.listFiles()?.forEach { it.delete() }; pending.clear() }
    @Synchronized
    fun clearPending() { pending.clear() }

    @Synchronized
    fun acceptChunk(message: JSONObject): Boolean {
        val hash = message.optString("hash")
        val count = message.optInt("chunks")
        val index = message.optInt("index", -1)
        val mimeType = message.optString("mimeType", "application/octet-stream")
        val encoded = message.optString("data")
        if (!HASH_PATTERN.matches(hash) || mimeType !in IMAGE_MIME_TYPES || count !in 1..MAX_ASSET_CHUNKS ||
            index !in 0 until count || encoded.isEmpty() || encoded.length > MAX_ASSET_CHUNK_BASE64_CHARS
        ) return false
        if (hash !in pending && pending.size >= MAX_PENDING_ASSETS) return false
        val transfer = pending.getOrPut(hash) { Pending(mimeType, arrayOfNulls(count)) }
        if (transfer.chunks.size != count || transfer.mimeType != mimeType) {
            pending.remove(hash)
            return false
        }
        val chunk = try {
            Base64.decode(encoded, Base64.DEFAULT)
        } catch (_: IllegalArgumentException) {
            pending.remove(hash)
            return false
        }
        val replacedBytes = transfer.chunks[index]?.size ?: 0
        val nextSize = transfer.receivedBytes - replacedBytes + chunk.size
        val aggregatePendingBytes = pending.values.sumOf { it.receivedBytes } - transfer.receivedBytes + nextSize
        if (chunk.isEmpty() || nextSize > MAX_ASSET_BYTES || aggregatePendingBytes > MAX_PENDING_BYTES) {
            pending.remove(hash)
            return false
        }
        transfer.chunks[index] = chunk
        transfer.receivedBytes = nextSize
        if (transfer.chunks.any { it == null }) return false
        val bytes = ByteArray(transfer.receivedBytes)
        var offset = 0
        transfer.chunks.forEach { part ->
            val chunkBytes = requireNotNull(part)
            chunkBytes.copyInto(bytes, destinationOffset = offset)
            offset += chunkBytes.size
        }
        val actualHash = MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
        if (actualHash != hash) {
            pending.remove(hash)
            File(directory, "$hash.tmp").delete()
            return false
        }
        if (!hasExpectedSignature(mimeType, bytes)) {
            pending.remove(hash)
            return false
        }
        val temporary = File(directory, "$hash.tmp")
        return runCatching {
            if (!enforceCacheBudget(bytes.size.toLong(), hash)) return@runCatching false
            temporary.writeBytes(bytes)
            val target = file(hash)
            if (target.exists()) {
                temporary.delete()
            } else {
                check(temporary.renameTo(target)) { "Не удалось сохранить ресурс Aether Deck" }
            }
            File(directory, "$hash.mime").writeText(transfer.mimeType)
            true
        }.getOrElse {
            temporary.delete()
            false
        }.also { saved -> if (saved) pending.remove(hash) }
    }

    fun mimeType(hash: String): String? = if (HASH_PATTERN.matches(hash)) File(directory, "$hash.mime").takeIf { it.exists() }?.readText() else null
    private fun file(hash: String) = File(directory, "$hash.asset")

    private fun cleanupOrphans() {
        directory.listFiles()?.forEach { candidate ->
            when {
                candidate.name.endsWith(".tmp") -> candidate.deleteRecursively()
                candidate.name.endsWith(".mime") && !file(candidate.name.removeSuffix(".mime")).isFile -> candidate.delete()
                candidate.name.endsWith(".asset") && !HASH_PATTERN.matches(candidate.name.removeSuffix(".asset")) -> candidate.delete()
            }
        }
    }

    private fun enforceCacheBudget(incomingBytes: Long, incomingHash: String?): Boolean {
        val allAssets = directory.listFiles()?.filter { it.isFile && it.name.endsWith(".asset") }.orEmpty()
        val existing = incomingHash?.let(::file)?.takeIf { it.isFile }
        val retained = allAssets.filter { it != existing }.toMutableList()
        var totalBytes = retained.sumOf { it.length() } + incomingBytes
        var totalAssets = retained.size + if (incomingHash == null) 0 else 1
        val evictionCandidates = retained.sortedBy { it.lastModified() }.iterator()
        while ((totalBytes > MAX_CACHE_BYTES || totalAssets > MAX_CACHE_ASSETS) && evictionCandidates.hasNext()) {
            val victim = evictionCandidates.next()
            totalBytes -= victim.length()
            totalAssets -= 1
            val victimHash = victim.name.removeSuffix(".asset")
            victim.delete()
            File(directory, "$victimHash.mime").delete()
        }
        return totalBytes <= MAX_CACHE_BYTES && totalAssets <= MAX_CACHE_ASSETS
    }

    private fun hasExpectedSignature(mimeType: String, bytes: ByteArray): Boolean = when (mimeType) {
        "image/png" -> bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        "image/jpeg" -> bytes.size >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte()
        "image/gif" -> bytes.size >= 6 && String(bytes, 0, 6, Charsets.US_ASCII) in setOf("GIF87a", "GIF89a")
        "image/webp" -> bytes.size >= 12 && String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP"
        "image/svg+xml" -> bytes.take(2048).toByteArray().toString(Charsets.UTF_8).trimStart('\uFEFF', ' ', '\t', '\r', '\n').let { source ->
            source.startsWith("<svg", ignoreCase = true) || source.startsWith("<?xml", ignoreCase = true) && source.contains("<svg", ignoreCase = true)
        }
        else -> false
    }
}
