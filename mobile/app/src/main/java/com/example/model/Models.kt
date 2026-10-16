package com.example.model

enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    AWAITING_APPROVAL,
    CONNECTED,
    RECONNECTING
}

sealed interface ConnectionState {
    object Disconnected : ConnectionState
    object Connecting : ConnectionState
    object AwaitingApproval : ConnectionState
    data class Connected(val hostConfig: HostConfig) : ConnectionState
    data class Reconnecting(val attempt: Int, val delaySec: Long) : ConnectionState
}

enum class NavigationTab {
    SYSTEM,
    MEDIA,
    TOOLS,
    POWER,
    AETHER_DECK
}

enum class HostPlatform {
    WINDOWS,
    LINUX,
    MACOS,
    UNKNOWN;

    companion object {
        fun fromWire(value: String?): HostPlatform = when (value?.trim()?.lowercase()) {
            "win32", "windows", "windows 10", "windows 11" -> WINDOWS
            "linux" -> LINUX
            "darwin", "macos", "mac os" -> MACOS
            else -> UNKNOWN
        }
    }
}

data class HostConfig(
    val ip: String = "",
    val port: Int = 8080,
    val token: String = "",
    val hostName: String = "",
    val macAddress: String = "",
    val isSimulator: Boolean = false,
    val transport: String = "lan",
    val platform: HostPlatform = HostPlatform.UNKNOWN
)

data class SystemStats(
    val cpu: Float = 0f,
    val ram: Float = 0f,
    val cpuName: String = "",
    val ramDetail: String = "",
    val uptime: String = "",
    val activeWindow: String = "",
    val monitorsCount: Int = 1,
    val currentMonitor: Int = 1,
    val hostname: String = "-"
)

data class ReceivedFile(
    val id: String,
    val fileName: String,
    val fileSize: Long,
    val savedPath: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

data class IncomingFileOffer(
    val fileId: String,
    val fileName: String,
    val fileSize: Long
)

data class FileTransferProgress(
    val fileId: String,
    val fileName: String,
    val fileSize: Long,
    val progress: Float,
    val isUploading: Boolean,
    val isCompleted: Boolean = false
)

data class MediaState(
    val volume: Int = 0,
    val isMuted: Boolean = false,
    val isPlaying: Boolean = false,
    val trackTitle: String = "",
    val artistName: String = ""
)

data class ClipboardData(
    val text: String = ""
)

data class ProcessInfo(
    val pid: Int,
    val name: String,
    val memoryMb: Float
)

data class WsAuthPayload(
    val type: String = "AUTH_REQUEST",
    val token: String
)

data class WsActionPayload(
    val type: String = "ACTION",
    val command: String,
    val value: Int? = null,
    val text: String? = null
)
