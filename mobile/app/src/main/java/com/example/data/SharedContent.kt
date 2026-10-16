package com.example.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.IntentCompat
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val MAX_SHARED_TEXT_LENGTH = 100_000

internal sealed interface ExternalShareRequest {
    data class Text(val text: String) : ExternalShareRequest
    data class File(val uri: Uri) : ExternalShareRequest
}

internal fun externalShareRequest(intent: Intent): ExternalShareRequest? {
    if (intent.action != Intent.ACTION_SEND || intent.type == null) return null
    sharedFileUri(intent)?.let { return ExternalShareRequest.File(it) }
    if (!intent.type.orEmpty().startsWith("text/")) return null
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotEmpty() } ?: return null
    require(text.length <= MAX_SHARED_TEXT_LENGTH) { "Текст слишком длинный" }
    return ExternalShareRequest.Text(text)
}

internal fun sharedFileUri(intent: Intent): Uri? =
    IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)

internal fun isExternalContentUri(uri: Uri, packageName: String): Boolean {
    val authority = uri.authority ?: return false
    return uri.scheme == "content" && authority.isNotBlank() &&
        '@' !in authority && authority != "$packageName.fileprovider"
}

internal suspend fun sendSharedContent(
    context: Context,
    uri: Uri,
    send: (String, Long, InputStream) -> Unit
): String = withContext(Dispatchers.IO) {
    require(isExternalContentUri(uri, context.packageName)) { "Недопустимый источник файла" }
    val provider = context.packageManager.resolveContentProvider(requireNotNull(uri.authority), 0)
    require(provider?.packageName != context.packageName) { "Нельзя передавать внутренние файлы приложения" }
    var name = "shared_${System.currentTimeMillis()}"
    var size = -1L
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (nameIndex >= 0 && !cursor.isNull(nameIndex)) {
                name = cursor.getString(nameIndex).takeIf { it.isNotBlank() }?.take(255) ?: name
            }
            if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) size = cursor.getLong(sizeIndex)
        }
    }
    require(size <= 500L * 1024 * 1024) { "Размер файла должен быть не больше 500 МБ" }
    val stream = context.contentResolver.openInputStream(uri) ?: error("Не удалось открыть файл")
    try {
        send(name, size, stream)
    } catch (error: Throwable) {
        stream.close()
        throw error
    }
    name
}
