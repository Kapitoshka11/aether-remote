package com.example.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Router
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.PitchBlack
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WakeOnLanTutorialSheet(
    pcName: String,
    includeBridge: Boolean,
    neverShowAgain: Boolean,
    onNeverShowAgainChange: (Boolean) -> Unit,
    onDismiss: () -> Unit,
    onWake: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = PitchBlack,
        contentColor = TextPrimary,
        dragHandle = { Spacer(Modifier.height(12.dp)) }
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Bolt, contentDescription = null, tint = AetherViolet)
                    Spacer(Modifier.height(10.dp))
                    Text("Wake-on-LAN", fontSize = 25.sp, fontWeight = FontWeight.Bold, fontStyle = FontStyle.Italic)
                    Text(
                        "Подготовьте ${pcName.ifBlank { "компьютер" }} к удалённому включению",
                        color = TextMuted,
                        fontSize = 13.sp
                    )
                }
            }

            TutorialStep(Icons.Default.Computer, "1 · BIOS / UEFI", "Включите Wake on LAN, Power On by PCI-E или похожую настройку питания.")
            TutorialStep(Icons.Default.Router, "2 · Windows", "В свойствах Ethernet-адаптера разрешите устройству выводить компьютер из спящего режима.")
            TutorialStep(Icons.Default.CheckCircle, "3 · Magic Packet", "В дополнительных свойствах сетевого адаптера включите Wake on Magic Packet. Надёжнее всего работает Ethernet.")
            if (includeBridge) {
                TutorialStep(Icons.Default.Bolt, "Включение через интернет", "Оставьте дома включённым хотя бы один компьютер с Aether Remote и активным Aether Wake Bridge.")
            }

            LiquidGlassCard(modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = neverShowAgain, onCheckedChange = onNeverShowAgainChange)
                    Text("Больше не показывать для этого компьютера", fontSize = 13.sp, color = TextPrimary)
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                LiquidGlassButton(onClick = onDismiss, modifier = Modifier.weight(1f)) {
                    Text("Настрою позже", color = TextPrimary)
                }
                LiquidGlassButton(onClick = onWake, isStrong = true, modifier = Modifier.weight(1f)) {
                    Text("Включить компьютер", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            }
            Spacer(Modifier.height(18.dp))
        }
    }
}

@Composable
private fun TutorialStep(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, body: String) {
    LiquidGlassCard(modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, tint = AetherViolet)
            Column(Modifier.weight(1f)) {
                Text(title, color = TextPrimary, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Spacer(Modifier.height(4.dp))
                Text(body, color = TextMuted, fontSize = 12.sp, lineHeight = 17.sp)
            }
        }
    }
}
