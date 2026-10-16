package com.example

import android.content.Intent
import android.net.Uri
import com.example.data.ExternalShareRequest
import com.example.data.externalShareRequest
import com.example.data.isExternalContentUri
import com.example.data.sharedFileUri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SharedContentTest {
    @Test
    fun rejectsPrivateFilesOwnProviderAndUserQualifiedAuthorities() {
        listOf(
            "file:///data/user/0/com.aether.remote/shared_prefs/secrets.xml",
            "content://com.aether.remote.fileprovider/downloads/private",
            "content://0@com.aether.remote.fileprovider/downloads/private",
            "https://example.com/file",
            "content:///missing-provider"
        ).forEach { assertFalse(it, isExternalContentUri(Uri.parse(it), "com.aether.remote")) }
        assertTrue(isExternalContentUri(Uri.parse("content://com.android.providers.downloads.documents/document/42"), "com.aether.remote"))
    }

    @Test
    fun textFileAttachmentRemainsAFileEvenWithTextMimeType() {
        val uri = Uri.parse("content://documents/report.txt")
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, uri).putExtra(Intent.EXTRA_TEXT, "caption")
        assertEquals(uri, sharedFileUri(intent))
        assertNull(sharedFileUri(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "hello")))
    }

    @Test
    fun externalSharesAreParsedAsPendingRequestsInsteadOfBeingSentDirectly() {
        val textIntent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "confirm me")
        val fileUri = Uri.parse("content://documents/report.txt")
        val fileIntent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_STREAM, fileUri)

        assertEquals(ExternalShareRequest.Text("confirm me"), externalShareRequest(textIntent))
        assertEquals(ExternalShareRequest.File(fileUri), externalShareRequest(fileIntent))
        assertNull(externalShareRequest(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"))))
    }

    @Test
    fun oversizedExternalTextIsRejectedBeforeConfirmation() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "x".repeat(100_001))

        assertThrows(IllegalArgumentException::class.java) { externalShareRequest(intent) }
    }
}
