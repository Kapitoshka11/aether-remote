package com.example.ui.screens

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NightsStay
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.RestartAlt
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.WifiTethering
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.window.Dialog
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.StatusOffline
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.wake.WakePowerAction
import com.example.wake.WakePowerActionDecision
import com.example.wake.WakeTutorialPreferences
import com.example.ui.components.WakeOnLanTutorialSheet
import com.example.data.AetherPreferences

@Composable
fun PowerSecurityTab(
    pcId: String,
    macAddress: String,
    onWake: () -> Unit,
    onShutdown: () -> Unit,
    onReboot: () -> Unit,
    onLock: () -> Unit,
    onSleep: () -> Unit
) {
    val context = LocalContext.current
    val tutorialPreferences = remember(pcId) {
        WakeTutorialPreferences(AetherPreferences.secure(context))
    }
    var selectedPowerAction by remember { mutableStateOf<PowerActionType?>(null) }
    var showWakeTutorial by remember { mutableStateOf(false) }
    var dismissWakeTutorial by remember { mutableStateOf(false) }

    fun requestWake() {
        when (WakePowerActionDecision.forPc(tutorialPreferences.isDismissed(pcId))) {
            WakePowerAction.SHOW_TUTORIAL -> showWakeTutorial = true
            WakePowerAction.SEND_WAKE -> onWake()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Питание и безопасность",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(20.dp))

        PowerCardItem(
            title = "Wake-on-LAN",
            subtitle = if (macAddress.isBlank()) "MAC-адрес пока неизвестен" else "Включить компьютер",
            icon = Icons.Default.WifiTethering,
            iconTint = Color(0xFF22D3EE),
            onClick = ::requestWake
        )

        Spacer(modifier = Modifier.height(14.dp))

        PowerCardItem(
            title = "Выключение ПК",
            subtitle = "Полностью выключить компьютер",
            icon = Icons.Default.PowerSettingsNew,
            iconTint = StatusOffline,
            onClick = { selectedPowerAction = PowerActionType.SHUTDOWN }
        )

        Spacer(modifier = Modifier.height(14.dp))

        PowerCardItem(
            title = "Перезагрузка ПК",
            subtitle = "Перезапустить компьютер",
            icon = Icons.Default.RestartAlt,
            iconTint = Color(0xFF38BDF8),
            onClick = { selectedPowerAction = PowerActionType.REBOOT }
        )

        Spacer(modifier = Modifier.height(14.dp))

        PowerCardItem(
            title = "Блокировка станции",
            subtitle = "Заблокировать Windows",
            icon = Icons.Default.Lock,
            iconTint = Color(0xFFEAB308),
            onClick = { selectedPowerAction = PowerActionType.LOCK }
        )

        Spacer(modifier = Modifier.height(14.dp))

        PowerCardItem(
            title = "Спящий режим",
            subtitle = "Перевести компьютер в сон",
            icon = Icons.Default.NightsStay,
            iconTint = Color(0xFFA855F7),
            onClick = { selectedPowerAction = PowerActionType.SLEEP }
        )

        Spacer(modifier = Modifier.height(120.dp))
    }

    selectedPowerAction?.let { action ->
        Dialog(onDismissRequest = { selectedPowerAction = null }) {
            LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(GlassWhiteMedium)
                            .border(1.dp, GlassBorderTopLight, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = null,
                            tint = StatusOffline,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = "Подтвердите действие",
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 22.sp,
                        color = TextPrimary
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    Text(
                        text = when (action) {
                            PowerActionType.SHUTDOWN -> "Вы действительно хотите полностью выключить ПК? Все несохраненные данные могут быть утеряны."
                            PowerActionType.REBOOT -> "Перезагрузить компьютер сейчас?"
                            PowerActionType.LOCK -> "Заблокировать сеанс пользователя?"
                            PowerActionType.SLEEP -> "Перевести сеанс ПК в спящий режим?"
                        },
                        fontSize = 13.sp,
                        color = TextMuted,
                        textAlign = TextAlign.Center,
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(24.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidGlassButton(
                            onClick = { selectedPowerAction = null },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Отмена", fontSize = 13.sp)
                        }

                        LiquidGlassButton(
                            onClick = {
                                when (action) {
                                    PowerActionType.SHUTDOWN -> onShutdown()
                                    PowerActionType.REBOOT -> onReboot()
                                    PowerActionType.LOCK -> onLock()
                                    PowerActionType.SLEEP -> onSleep()
                                }
                                selectedPowerAction = null
                            },
                            isStrong = true,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Выполнить", fontSize = 13.sp, color = TextPrimary)
                        }
                    }
                }
            }
        }
    }

    if (showWakeTutorial) {
        WakeOnLanTutorialSheet(
            pcName = pcId,
            includeBridge = false,
            neverShowAgain = dismissWakeTutorial,
            onNeverShowAgainChange = { dismissWakeTutorial = it },
            onDismiss = { showWakeTutorial = false },
            onWake = {
                if (dismissWakeTutorial) tutorialPreferences.dismiss(pcId)
                showWakeTutorial = false
                dismissWakeTutorial = false
                onWake()
            }
        )
    }
}

@Composable
private fun PowerCardItem(
    title: String,
    subtitle: String,
    icon: ImageVector,
    iconTint: Color,
    onClick: () -> Unit
) {
    LiquidGlassCard(
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onClick() }
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(GlassWhiteLight)
                    .border(1.dp, GlassBorderTopLight, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = title,
                    tint = iconTint,
                    modifier = Modifier.size(22.dp)
                )
            }

            Spacer(modifier = Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = subtitle,
                    fontSize = 12.sp,
                    color = TextMuted
                )
            }
        }
    }
}

private enum class PowerActionType {
    SHUTDOWN,
    REBOOT,
    LOCK,
    SLEEP
}
