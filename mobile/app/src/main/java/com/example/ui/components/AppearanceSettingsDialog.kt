package com.example.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.ui.theme.AetherThemeMode
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.PitchBlack

@Composable
fun AppearanceSettingsDialog(
    themeMode: AetherThemeMode,
    onThemeChange: (AetherThemeMode) -> Unit,
    onDismiss: () -> Unit,
    accountContent: (@Composable () -> Unit)? = null
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        LiquidGlassStrongCard(
            modifier = Modifier
                .widthIn(max = 560.dp)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .padding(horizontal = 20.dp)
                .heightIn(max = (LocalConfiguration.current.screenHeightDp - 32).coerceAtLeast(160).dp)
                .background(PitchBlack, RoundedCornerShape(30.dp)),
            shape = RoundedCornerShape(30.dp)
        ) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(22.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(42.dp)
                                .background(AetherViolet, RoundedCornerShape(14.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Settings, contentDescription = null, tint = Color.White)
                        }
                        Spacer(Modifier.size(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(
                                "Настройки",
                                color = TextPrimary,
                                fontFamily = FontFamily.Serif,
                                fontStyle = FontStyle.Italic,
                                fontSize = 25.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text("Аккаунт и приложение", color = TextMuted, fontSize = 12.sp)
                        }
                    }
                    Box(
                        modifier = Modifier
                            .size(48.dp)
                            .background(GlassWhiteLight, CircleShape)
                            .clickable(onClick = onDismiss),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Закрыть", tint = TextPrimary)
                    }
                }

                Spacer(Modifier.height(24.dp))
                accountContent?.invoke()
                if (accountContent != null) {
                    Spacer(Modifier.height(20.dp))
                }
                Text(
                    "ТЕМА",
                    color = TextMuted,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 2.sp
                )
                Spacer(Modifier.height(10.dp))

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    ThemeChoice(
                        title = "Тёмная",
                        subtitle = "Глубокий чёрный",
                        selected = themeMode == AetherThemeMode.DARK,
                        dark = true,
                        modifier = Modifier.weight(1f),
                        onClick = { onThemeChange(AetherThemeMode.DARK) }
                    )
                    ThemeChoice(
                        title = "Светлая",
                        subtitle = "Тёплый оранжевый",
                        selected = themeMode == AetherThemeMode.LIGHT,
                        dark = false,
                        modifier = Modifier.weight(1f),
                        onClick = { onThemeChange(AetherThemeMode.LIGHT) }
                    )
                }

                Spacer(Modifier.height(18.dp))
                Text(
                    "Выбор сохраняется автоматически и применяется ко всем экранам, включая Aether Deck.",
                    color = TextMuted,
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
    }
}

@Composable
private fun ThemeChoice(
    title: String,
    subtitle: String,
    selected: Boolean,
    dark: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(20.dp)
    val background = if (dark) {
        Brush.verticalGradient(listOf(Color(0xFF19110E), Color(0xFF050505)))
    } else {
        Brush.verticalGradient(listOf(Color(0xFFFFD8BD), Color(0xFFFFF8F2)))
    }
    val foreground = if (dark) Color.White else Color(0xFF3A1C12)

    Column(
        modifier = modifier
            .height(142.dp)
            .background(background, shape)
            .border(if (selected) 2.dp else 1.dp, if (selected) AetherViolet else GlassBorderTopLight, shape)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Icon(
                if (dark) Icons.Default.DarkMode else Icons.Default.LightMode,
                contentDescription = null,
                tint = if (dark) Color(0xFFFFA36B) else Color(0xFFE14923)
            )
            if (selected) {
                Box(Modifier.size(22.dp).background(AetherViolet, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Default.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                }
            }
        }
        Column {
            Text(title, color = foreground, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            Text(subtitle, color = foreground.copy(alpha = 0.58f), fontSize = 10.sp)
        }
    }
}
