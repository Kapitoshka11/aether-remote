package com.example.network

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.example.account.AccountRepository
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.data.ExternalShareRequest

internal data class PendingExternalShare(
    val request: ExternalShareRequest,
    val peerIdentity: String?
)

class PcConnectionViewModel(application: Application) : AndroidViewModel(application) {
    val socketManager = PcWebSocketManager(application)
    val accountRepository = AccountRepository(application)
    internal var pendingShare by mutableStateOf<PendingExternalShare?>(null)

    init {
        viewModelScope.launch {
            accountRepository.state.collect { state ->
                val owner = socketManager.accountOwnerId
                if (owner != null && (owner != state.profile?.id || state.devices.any {
                        it.revoked && (it.id == socketManager.accountHostDeviceId || it.id == socketManager.accountPhoneDeviceId)
                    })) {
                    socketManager.disconnect()
                }
            }
        }
    }

    override fun onCleared() {
        socketManager.destroy()
        accountRepository.destroy()
    }
}
