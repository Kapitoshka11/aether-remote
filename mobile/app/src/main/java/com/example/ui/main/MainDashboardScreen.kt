package com.example.ui.main

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material.icons.filled.DashboardCustomize
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.ConnectionStatus
import com.example.model.NavigationTab
import com.example.network.PcWebSocketManager
import com.example.ui.components.LiquidGlassCard
import com.example.ui.components.AetherBackdrop
import com.example.ui.components.StatusBadge
import com.example.ui.components.AppearanceSettingsDialog
import com.example.ui.screens.MediaSuiteTab
import com.example.ui.screens.PairingGateScreen
import com.example.ui.screens.PowerSecurityTab
import com.example.ui.screens.SystemControlsTab
import com.example.ui.screens.ToolsUtilitiesTab
import com.example.ui.screens.AetherDeckTab
import com.example.ui.screens.AetherDeckOrientationPrompt
import com.example.ui.screens.AetherDeckOrientationVisitState
import com.example.ui.screens.findActivity
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteStrong
import com.example.ui.theme.PitchBlack
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.AetherThemeMode
import com.example.account.AccountRepository
import com.example.ui.screens.AccountSettingsSection
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch

@OptIn(ExperimentalAnimationApi::class)
@Composable
fun MainDashboardScreen(
    socketManager: PcWebSocketManager,
    themeMode: AetherThemeMode,
    onThemeModeChange: (AetherThemeMode) -> Unit,
    accountRepository: AccountRepository? = null
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val activity = context.findActivity()
    val accountScope = rememberCoroutineScope()
    val approvalCode by socketManager.accountApprovalCode.collectAsState()
    val accountState = accountRepository?.state?.collectAsState()?.value

    val connectionStatus by socketManager.connectionStatus.collectAsState()
    val hostConfig by socketManager.hostConfig.collectAsState()
    val systemStats by socketManager.systemStats.collectAsState()
    val mediaState by socketManager.mediaState.collectAsState()
    val clipboardData by socketManager.clipboardData.collectAsState()
    val clipboardHistory by socketManager.clipboardHistory.collectAsState()
    val latestScreenshotBitmap by socketManager.latestScreenshotBitmap.collectAsState()
    val isCapturingScreenshot by socketManager.isCapturingScreenshot.collectAsState()
    val actionFeedback by socketManager.actionFeedback.collectAsState()
    val adminConfirmCommand by socketManager.adminConfirmCommand.collectAsState()
    val latencyMs by socketManager.latencyMs.collectAsState()
    val isAudioStreamEnabled by socketManager.isAudioStreamEnabled.collectAsState()
    val fileTransferProgress by socketManager.fileTransferProgress.collectAsState()
    val receivedFiles by socketManager.receivedFiles.collectAsState()
    val incomingFileOffer by socketManager.incomingFileOffer.collectAsState()
    val deckState by socketManager.deckState.collectAsState()
    val deckAssetRevision by socketManager.deckAssetRevision.collectAsState()

    var currentTab by rememberSaveable { mutableStateOf(NavigationTab.SYSTEM) }
    var showPairingGate by rememberSaveable { mutableStateOf(false) }
    val deckOrientationVisitState = remember { AetherDeckOrientationVisitState() }
    var showDeckOrientationPrompt by remember { mutableStateOf(false) }
    var showAppearanceSettings by rememberSaveable { mutableStateOf(false) }
    val accountHosts = accountState?.devices?.filter { it.kind == "host" && !it.revoked }.orEmpty()
    val connectAccountHost: (com.example.account.AccountDevice) -> Unit = { host ->
        accountRepository?.let { repository ->
            accountScope.launch {
                try {
                    val connection = repository.prepareConnection(host)
                    socketManager.connectAccount(connection)
                    showAppearanceSettings = false
                    showPairingGate = false
                } catch (error: Exception) {
                    repository.reportError(error)
                }
            }
        }
    }
    val isAetherDeckActive = currentTab == NavigationTab.AETHER_DECK &&
        !showPairingGate && connectionStatus != ConnectionStatus.DISCONNECTED

    DisposableEffect(activity) {
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    LaunchedEffect(isAetherDeckActive) {
        if (!isAetherDeckActive) {
            deckOrientationVisitState.leave()
            showDeckOrientationPrompt = false
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }

    LaunchedEffect(currentTab) {
        if (currentTab != NavigationTab.SYSTEM) socketManager.cancelScreenshotRequest()
    }

    LaunchedEffect(isAetherDeckActive, configuration.orientation) {
        if (isAetherDeckActive) {
            if (configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) {
                if (showDeckOrientationPrompt) {
                    deckOrientationVisitState.markHandled()
                    showDeckOrientationPrompt = false
                }
            } else if (
                configuration.orientation == Configuration.ORIENTATION_PORTRAIT &&
                deckOrientationVisitState.shouldShow(isPortrait = true)
            ) {
                showDeckOrientationPrompt = true
            }
        }
    }

    if (approvalCode != null && connectionStatus != ConnectionStatus.DISCONNECTED) {
        AlertDialog(onDismissRequest = { socketManager.disconnect() }, title = { Text("Подтвердите телефон на ПК") },
            text = { Text("Код на компьютере должен совпадать: $approvalCode") },
            confirmButton = {}, dismissButton = { TextButton(onClick = { socketManager.disconnect() }) { Text("Отмена") } })
    }
    if (showPairingGate || connectionStatus == ConnectionStatus.DISCONNECTED) {
        Box(Modifier.fillMaxSize()) {
            PairingGateScreen(
                onConnect = { ip, port, pin, isSim, tlsFingerprint ->
                    showPairingGate = false
                    socketManager.connect(ip, port, pin, isSim, tlsFingerprint)
                },
                onOpenSettings = { showAppearanceSettings = true },
                accountHosts = accountHosts,
                onConnectAccountHost = connectAccountHost
            )
            if (showAppearanceSettings) {
                AppearanceSettingsDialog(
                    themeMode = themeMode,
                    onThemeChange = onThemeModeChange,
                    onDismiss = { showAppearanceSettings = false },
                    accountContent = accountRepository?.let { repository ->
                        {
                            AccountSettingsSection(
                                repository = repository,
                                onSignOut = { socketManager.disconnect() },
                                onConnect = connectAccountHost
                            )
                        }
                    }
                )
            }
        }
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .background(PitchBlack)
    ) {
        AetherBackdrop(modifier = Modifier.fillMaxSize())
        Column(modifier = Modifier.fillMaxSize()) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    StatusBadge(
                        status = connectionStatus,
                        hostName = hostConfig.hostName,
                        modifier = Modifier.weight(1f),
                        transport = hostConfig.transport
                    )
                    latencyMs?.let { ms ->
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "${ms}ms",
                            fontSize = 11.sp,
                            color = if (ms < 50) Color.Green else Color.Yellow,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    HeaderIconButton(
                        icon = Icons.Default.Settings,
                        contentDescription = "Настройки",
                        onClick = { showAppearanceSettings = true }
                    )

                    HeaderIconButton(
                        icon = Icons.Default.Refresh,
                        contentDescription = "Обновить",
                        onClick = { socketManager.sendAction("GET_SYSTEM_STATS") }
                    )

                    HeaderIconButton(
                        icon = Icons.Default.LinkOff,
                        contentDescription = "Отключиться от ПК",
                        onClick = {
                            socketManager.disconnect()
                            showPairingGate = true
                        }
                    )
                }
            }

            AnimatedContent(
                targetState = currentTab,
                transitionSpec = {
                    (fadeIn() + slideInVertically { 15 }).togetherWith(fadeOut() + slideOutVertically { -15 })
                },
                modifier = Modifier.weight(1f)
            ) { tab ->
                when (tab) {
                    NavigationTab.SYSTEM -> {
                        val isLiveStreaming by socketManager.isLiveStreaming.collectAsState()
                        val isTelemetryStale by socketManager.isTelemetryStale.collectAsState()
                        SystemControlsTab(
                            systemStats = systemStats,
                            screenshotBitmap = latestScreenshotBitmap,
                            isCapturingScreenshot = isCapturingScreenshot,
                            isLiveStreaming = isLiveStreaming,
                            isAudioStreamEnabled = isAudioStreamEnabled,
                            isTelemetryStale = isTelemetryStale,
                            onToggleLiveStreaming = { socketManager.setLiveStreaming(it) },
                            onToggleAudioStream = { socketManager.toggleAudioStream(it) },
                            onSwitchMonitor = { socketManager.switchMonitor(it) },
                            onTakeScreenshot = { socketManager.takeScreenshot() },
                            onCloseActiveWindow = { socketManager.sendAction("CLOSE_WINDOW") }
                        )
                    }
                    NavigationTab.MEDIA -> MediaSuiteTab(
                        mediaState = mediaState,
                        onVolumeChange = { socketManager.sendAction("VOLUME_SET", value = it) },
                        onVolumeStepUp = { socketManager.sendAction("VOLUME_UP", value = 5) },
                        onVolumeStepDown = { socketManager.sendAction("VOLUME_DOWN", value = 5) },
                        onToggleMute = { socketManager.sendAction("VOLUME_MUTE") },
                        onPlayPause = { socketManager.sendAction("MEDIA_PLAY_PAUSE") },
                        onNextTrack = { socketManager.sendAction("MEDIA_NEXT") },
                        onPreviousTrack = { socketManager.sendAction("MEDIA_PREV") }
                    )
                    NavigationTab.POWER -> PowerSecurityTab(
                        pcId = socketManager.accountHostDeviceId ?: "${hostConfig.ip}:${hostConfig.port}",
                        macAddress = hostConfig.macAddress,
                        onWake = socketManager::wakeCurrentPc,
                        onShutdown = { socketManager.sendAction("POWER_SHUTDOWN") },
                        onReboot = { socketManager.sendAction("POWER_REBOOT") },
                        onLock = { socketManager.sendAction("POWER_LOCK") },
                        onSleep = { socketManager.sendAction("POWER_SLEEP") }
                    )
                    NavigationTab.TOOLS -> ToolsUtilitiesTab(
                        clipboardData = clipboardData,
                        clipboardHistory = clipboardHistory,
                        fileTransferProgress = fileTransferProgress,
                        receivedFiles = receivedFiles,
                        onReadPcClipboard = { socketManager.sendAction("GET_CLIPBOARD") },
                        onSendToPcClipboard = { socketManager.sendAction("SET_CLIPBOARD", text = it) },
                        onDeleteClipboardItem = socketManager::deleteClipboardHistoryItem,
                        onClearClipboardHistory = socketManager::clearClipboardHistory,
                        onDisconnect = { socketManager.disconnect() },
                        onSendFileToPc = { fileName, fileSize, bytes -> socketManager.sendFileToPc(fileName, fileSize, bytes) },
                        onSendFileStreamToPc = { fileName, fileSize, stream -> socketManager.sendFileStreamToPc(fileName, fileSize, stream) }
                    )
                    NavigationTab.AETHER_DECK -> AetherDeckTab(
                        state = deckState,
                        onSync = { socketManager.deckStore.requestDeckSync() },
                        onTrigger = { control -> deckState.activeDeck?.id?.let { deckId -> deckState.activePage?.id?.let { pageId -> socketManager.deckStore.triggerControl(deckId, pageId, control.id) } } },
                        onSlider = { control, value -> deckState.activeDeck?.id?.let { deckId -> deckState.activePage?.id?.let { pageId -> socketManager.deckStore.setSliderValue(deckId, pageId, control.id, value) } } },
                        onNavigate = { deckId, pageId -> socketManager.deckStore.navigateTo(deckId, pageId) },
                        onNavigateBack = { socketManager.deckStore.navigateBack() },
                        assetRevision = deckAssetRevision,
                        loadAsset = socketManager::getDeckAsset,
                        requestAsset = socketManager::requestDeckAsset
                    )
                }
            }
        }

        actionFeedback?.let { feedback ->
            Box(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(start = 20.dp, end = 20.dp, top = 80.dp)
            ) {
                LiquidGlassCard(
                    shape = RoundedCornerShape(9999.dp)
                ) {
                    Text(
                        text = feedback,
                        fontSize = 12.sp,
                        color = TextPrimary,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp)
                    )
                }
            }
        }

        if (showDeckOrientationPrompt) {
            AetherDeckOrientationPrompt(
                onLandscape = {
                    deckOrientationVisitState.markHandled()
                    showDeckOrientationPrompt = false
                    activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                },
                onStay = {
                    deckOrientationVisitState.markHandled()
                    showDeckOrientationPrompt = false
                }
            )
        }

        if (showAppearanceSettings) {
            AppearanceSettingsDialog(
                themeMode = themeMode,
                onThemeChange = onThemeModeChange,
                onDismiss = { showAppearanceSettings = false },
                accountContent = accountRepository?.let { repository ->
                    {
                        AccountSettingsSection(
                            repository = repository,
                            onSignOut = { socketManager.disconnect() },
                            onConnect = connectAccountHost
                        )
                    }
                }
            )
        }


        incomingFileOffer?.let { offer ->
            AlertDialog(
                onDismissRequest = { socketManager.rejectIncomingFile(offer.fileId) },
                confirmButton = {
                    TextButton(onClick = { socketManager.acceptIncomingFile(offer.fileId) }) {
                        Text("Принять", color = AetherViolet)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { socketManager.rejectIncomingFile(offer.fileId) }) {
                        Text("Отклонить", color = TextPrimary)
                    }
                },
                title = { Text("Входящий файл", color = TextPrimary) },
                text = {
                    Text(
                        "${offer.fileName}\n${String.format(java.util.Locale.getDefault(), "%.1f МБ", offer.fileSize / 1024.0 / 1024.0)}",
                        color = TextMuted
                    )
                },
                containerColor = MaterialTheme.colorScheme.surface
            )
        }

        adminConfirmCommand?.let { cmd ->
            AlertDialog(
                onDismissRequest = { socketManager.clearAdminConfirm() },
                confirmButton = {
                    TextButton(onClick = { socketManager.confirmAdminCommand(cmd) }) {
                        Text("Выполнить", color = Color(0xFFF43F5E))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { socketManager.clearAdminConfirm() }) {
                        Text("Отмена", color = TextPrimary)
                    }
                },
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFF43F5E))
                        Spacer(Modifier.width(8.dp))
                        Text("Запрос разрешения", color = TextPrimary)
                    }
                },
                text = {
                    Column {
                        Text("Эта команда может быть опасна. Выполнить?", color = TextMuted)
                        Spacer(Modifier.height(8.dp))
                        Text(cmd, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color(0xFFF43F5E))
                    }
                },
                containerColor = MaterialTheme.colorScheme.surface,
                titleContentColor = TextPrimary,
                textContentColor = TextMuted
            )
        }

        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 24.dp, start = 16.dp, end = 16.dp)
        ) {
            LiquidGlassCard(
                shape = RoundedCornerShape(9999.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    NavItem(
                        icon = Icons.Default.Computer,
                        label = "Система",
                        isSelected = currentTab == NavigationTab.SYSTEM,
                        onClick = { currentTab = NavigationTab.SYSTEM }
                    )

                    NavItem(
                        icon = Icons.Default.MusicNote,
                        label = "Медиа",
                        isSelected = currentTab == NavigationTab.MEDIA,
                        onClick = { currentTab = NavigationTab.MEDIA }
                    )

                    NavItem(
                        icon = Icons.Default.Widgets,
                        label = "Утилиты",
                        isSelected = currentTab == NavigationTab.TOOLS,
                        onClick = { currentTab = NavigationTab.TOOLS }
                    )

                    NavItem(
                        icon = Icons.Default.PowerSettingsNew,
                        label = "Питание",
                        isSelected = currentTab == NavigationTab.POWER,
                        onClick = { currentTab = NavigationTab.POWER }
                    )

                    NavItem(
                        icon = Icons.Default.DashboardCustomize,
                        label = "Aether Deck",
                        isSelected = currentTab == NavigationTab.AETHER_DECK,
                        onClick = { currentTab = NavigationTab.AETHER_DECK }
                    )
                }
            }
        }
    }
}

@Composable
private fun HeaderIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .size(48.dp)
            .clip(CircleShape)
            .background(GlassWhiteLight)
            .border(1.dp, GlassBorderTopLight, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = TextPrimary,
            modifier = Modifier.size(18.dp)
        )
    }
}

@Composable
private fun NavItem(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val bg = if (isSelected) AetherViolet.copy(alpha = 0.92f) else Color.Transparent
    val tint = if (isSelected) Color.White else TextMuted

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(9999.dp))
            .background(bg)
            .clickable { onClick() }
            .heightIn(min = 48.dp)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = icon,
            contentDescription = label,
            tint = tint,
            modifier = Modifier.size(18.dp)
        )
        if (isSelected) {
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = label,
                fontSize = 11.sp,
                fontWeight = FontWeight.Medium,
                color = Color.White
            )
        }
    }
}
