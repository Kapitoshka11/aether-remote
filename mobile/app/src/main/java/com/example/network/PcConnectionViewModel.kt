package com.example.network

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.example.account.AccountRepository
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class PcConnectionViewModel(application: Application) : AndroidViewModel(application) {
    val socketManager = PcWebSocketManager(application)
    val accountRepository = AccountRepository(application)

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
