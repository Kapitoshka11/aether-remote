package com.example

import android.content.Intent
import android.os.Bundle
import com.example.data.ExternalShareRequest
import com.example.data.externalShareRequest
import com.example.data.sendSharedContent
import kotlinx.coroutines.CancellationException
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.example.network.PcWebSocketManager
import com.example.network.PcConnectionViewModel
import com.example.ui.main.MainDashboardScreen
import com.example.ui.theme.AetherTheme
import com.example.data.ThemePreferenceStore
import androidx.lifecycle.lifecycleScope
import androidx.activity.viewModels
import com.example.model.ConnectionStatus
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

class MainActivity : ComponentActivity() {

    private data class PendingExternalShare(
        val request: ExternalShareRequest,
        val peerIdentity: String?
    )

    private val connectionViewModel: PcConnectionViewModel by viewModels()
    private val socketManager: PcWebSocketManager get() = connectionViewModel.socketManager
    private var pendingShare by mutableStateOf<PendingExternalShare?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        handleShareIntent(intent)
        handleAccountIntent(intent)

        val themePreferences = ThemePreferenceStore(getSharedPreferences("aether_appearance", MODE_PRIVATE))
        setContent {
            var themeMode by remember { mutableStateOf(themePreferences.load()) }
            val connectionStatus by socketManager.connectionStatus.collectAsState()
            val peerIdentity by socketManager.authenticatedPeerIdentity.collectAsState()
            val hostConfig by socketManager.hostConfig.collectAsState()
            LaunchedEffect(peerIdentity) {
                val pending = pendingShare
                if (pending != null) {
                    when {
                        pending.peerIdentity == null && peerIdentity != null -> {
                            pendingShare = pending.copy(peerIdentity = peerIdentity)
                        }
                        pending.peerIdentity != null && pending.peerIdentity != peerIdentity -> {
                            pendingShare = null
                            Toast.makeText(this@MainActivity, "Получатель изменился — отправка отменена", Toast.LENGTH_SHORT).show()
                        }
                    }
                }
            }
            AetherTheme(themeMode = themeMode) {
                MainDashboardScreen(
                    socketManager = socketManager,
                    accountRepository = connectionViewModel.accountRepository,
                    themeMode = themeMode,
                    onThemeModeChange = { selected ->
                        themeMode = selected
                        themePreferences.save(selected)
                    }
                )
                pendingShare?.let { pending ->
                    val canSend = connectionStatus == ConnectionStatus.CONNECTED &&
                        pending.peerIdentity != null && pending.peerIdentity == peerIdentity
                    AlertDialog(
                        onDismissRequest = { pendingShare = null },
                        title = { Text("Отправить на ПК?") },
                        text = {
                            Column {
                                Text(
                                    when (val request = pending.request) {
                                        is ExternalShareRequest.Text -> "Текст: ${request.text.take(160)}"
                                        is ExternalShareRequest.File -> "Файл: ${request.uri.lastPathSegment?.takeLast(100) ?: "общий файл"}"
                                    }
                                )
                                Text(
                                    if (canSend) "Получатель: ${hostConfig.hostName.ifBlank { hostConfig.ip }}"
                                    else "Сначала подключитесь к нужному ПК"
                                )
                            }
                        },
                        confirmButton = {
                            TextButton(onClick = { confirmPendingShare(pending) }, enabled = canSend) {
                                Text("Отправить")
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { pendingShare = null }) { Text("Отмена") }
                        }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        handleAccountIntent(intent)
    }

    private fun handleAccountIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW && intent.data?.scheme == "aetherremote") {
            connectionViewModel.accountRepository.handleCallback(intent.data!!)
        }
    }

    override fun onStart() {
        super.onStart()
        socketManager.onAppForegrounded()
        connectionViewModel.accountRepository.setForeground(true)
    }

    override fun onStop() {
        socketManager.onAppBackgrounded()
        connectionViewModel.accountRepository.setForeground(socketManager.connectionStatus.value == ConnectionStatus.CONNECTED)
        super.onStop()
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent == null) return
        try {
            val request = externalShareRequest(intent) ?: return
            pendingShare = PendingExternalShare(request, socketManager.authenticatedPeerIdentity.value)
            val message = if (socketManager.connectionStatus.value == ConnectionStatus.CONNECTED) {
                "Проверьте получателя и подтвердите отправку"
            } else {
                "Подключитесь к нужному ПК и подтвердите отправку"
            }
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        } catch (error: IllegalArgumentException) {
            Toast.makeText(this, error.message ?: "Недопустимые общие данные", Toast.LENGTH_SHORT).show()
        }
    }

    private fun confirmPendingShare(pending: PendingExternalShare) {
        if (pendingShare != pending) return
        val peerIdentity = socketManager.authenticatedPeerIdentity.value
        if (socketManager.connectionStatus.value != ConnectionStatus.CONNECTED || peerIdentity == null ||
            pending.peerIdentity == null || pending.peerIdentity != peerIdentity
        ) {
            pendingShare = null
            Toast.makeText(this, "Получатель изменился — отправка отменена", Toast.LENGTH_SHORT).show()
            return
        }
        pendingShare = null
        when (val request = pending.request) {
            is ExternalShareRequest.Text -> {
                val sent = socketManager.sendClipboardForPeer(peerIdentity, request.text)
                Toast.makeText(
                    this,
                    if (sent) "Текст отправлен в буфер обмена ПК" else "Не удалось отправить текст: соединение изменилось",
                    Toast.LENGTH_SHORT
                ).show()
            }
            is ExternalShareRequest.File -> lifecycleScope.launch {
                try {
                    val name = sendSharedContent(this@MainActivity, request.uri) { fileName, fileSize, stream ->
                        socketManager.sendFileStreamToPcForPeer(peerIdentity, fileName, fileSize, stream)
                    }
                    Toast.makeText(this@MainActivity, "Передача $name на ПК...", Toast.LENGTH_SHORT).show()
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "Не удалось открыть общий файл", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }
}
