package com.example.ui.screens

import android.graphics.Bitmap
import android.content.pm.ActivityInfo
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
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
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.IntSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Camera
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Tv
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import android.content.ContentValues
import android.content.Intent
import android.media.MediaScannerConnection
import android.provider.MediaStore
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.activity.compose.BackHandler
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.example.model.SystemStats
import com.example.ui.components.GlassCircularProgress
import com.example.ui.components.GlassShimmerLoader
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.StatusOnline
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun SystemControlsTab(
    systemStats: SystemStats,
    screenshotBitmap: Bitmap?,
    isCapturingScreenshot: Boolean,
    isLiveStreaming: Boolean,
    isAudioStreamEnabled: Boolean = false,
    isTelemetryStale: Boolean = false,
    onToggleLiveStreaming: (Boolean) -> Unit,
    onToggleAudioStream: (Boolean) -> Unit = {},
    onSwitchMonitor: (Int) -> Unit = {},
    onTakeScreenshot: () -> Unit,
    onCloseActiveWindow: () -> Unit,
    onMouseMove: (Int, Int) -> Unit = { _, _ -> },
    onMouseClick: (String) -> Unit = {},
    onMouseScroll: (Int) -> Unit = {},
    onSendText: (String) -> Unit = {},
    onSendKey: (String, List<String>) -> Unit = { _, _ -> },
    onTapScreen: (Float, Float) -> Unit = { _, _ -> },
    onLongPressScreen: (Float, Float) -> Unit = { _, _ -> }
) {
    val context = LocalContext.current
    val ioScope = rememberCoroutineScope()
    var showFullscreenScreenshot by rememberSaveable { mutableStateOf(false) }
    var showCloseWindowConfirmDialog by rememberSaveable { mutableStateOf(false) }
    var touchpadSensitivity by rememberSaveable { mutableFloatStateOf(1.6f) }
    var keyboardDraft by rememberSaveable { mutableStateOf("") }
    var ctrlActive by rememberSaveable { mutableStateOf(false) }
    var altActive by rememberSaveable { mutableStateOf(false) }
    var shiftActive by rememberSaveable { mutableStateOf(false) }
    var winActive by rememberSaveable { mutableStateOf(false) }
    val fullscreenStreamState = remember { StreamFullscreenState() }

    LaunchedEffect(isLiveStreaming, screenshotBitmap) {
        if (fullscreenStreamState.isFullscreen && (!isLiveStreaming || screenshotBitmap == null)) {
            delay(500)
        }
        fullscreenStreamState.updateAvailability(isLiveStreaming, screenshotBitmap != null)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Мониторинг ресурсов",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(14.dp))

        if (isTelemetryStale) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                shape = RoundedCornerShape(12.dp),
                color = Color(0x33FFB300),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFFFFB300))
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Warning,
                        contentDescription = null,
                        tint = Color(0xFFFFB300),
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        text = "Данные устарели (более 5 сек без обновлений)",
                        color = Color(0xFFFFB300),
                        fontSize = 12.sp
                    )
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .alpha(if (isTelemetryStale) 0.5f else 1f),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            GlassCircularProgress(
                percentage = systemStats.cpu,
                label = "Центральный процессор",
                icon = {
                    Icon(
                        imageVector = Icons.Default.Memory,
                        contentDescription = "CPU",
                        tint = TextPrimary,
                        modifier = Modifier.size(20.dp)
                    )
                },
                modifier = Modifier.weight(1f)
            )

            GlassCircularProgress(
                percentage = systemStats.ram,
                label = "Оперативная память",
                icon = {
                    Icon(
                        imageVector = Icons.Default.Speed,
                        contentDescription = "RAM",
                        tint = TextPrimary,
                        modifier = Modifier.size(20.dp)
                    )
                },
                modifier = Modifier.weight(1f)
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "ЦП: ${systemStats.cpuName}",
                    fontSize = 11.sp,
                    color = TextMuted,
                    maxLines = 1
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = "ОЗУ: ${systemStats.ramDetail}",
                    fontSize = 11.sp,
                    color = TextMuted,
                    maxLines = 1
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Удалённый экран",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(14.dp))

        LiquidGlassCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .aspectRatio(16f / 9f)
                        .clip(RoundedCornerShape(16.dp))
                        .background(GlassWhiteLight)
                        .border(1.dp, GlassBorderTopLight, RoundedCornerShape(16.dp))
                        .clickable {
                            if (screenshotBitmap != null) {
                                if (isLiveStreaming) fullscreenStreamState.enter() else showFullscreenScreenshot = true
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    if (isCapturingScreenshot) {
                        GlassShimmerLoader(modifier = Modifier.fillMaxSize())
                    } else if (screenshotBitmap != null) {
                        Box(modifier = Modifier.fillMaxSize()) {
                            Image(
                                bitmap = screenshotBitmap.asImageBitmap(),
                                contentDescription = "Снимок рабочего стола",
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop
                            )
                            if (isLiveStreaming) {
                                Row(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(10.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color(0xBB4CAF50))
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(Color.White)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "LIVE",
                                        color = Color.White,
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.BottomEnd)
                                        .padding(10.dp)
                                        .size(48.dp)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = .65f))
                                        .clickable { fullscreenStreamState.enter() },
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(Icons.Default.Fullscreen, contentDescription = "Полный экран", tint = Color.White)
                                }
                            }
                        }
                    } else {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Default.Computer,
                                contentDescription = null,
                                tint = TextMuted,
                                modifier = Modifier.size(36.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Обновить снимок",
                                fontSize = 12.sp,
                                color = TextMuted
                            )
                        }
                    }
                }

                if (systemStats.monitorsCount > 1) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Монитор",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextMuted
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        for (i in 1..systemStats.monitorsCount) {
                            val isSelected = systemStats.currentMonitor == i
                            LiquidGlassButton(
                                onClick = { onSwitchMonitor(i) },
                                isStrong = isSelected,
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Tv,
                                    contentDescription = "Монитор $i",
                                    tint = if (isSelected) AetherViolet else TextMuted,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "Монитор $i",
                                    fontSize = 12.sp,
                                    color = TextPrimary
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LiquidGlassButton(
                        onClick = onTakeScreenshot,
                        isStrong = !isLiveStreaming,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Camera,
                            contentDescription = "Сделать снимок",
                            tint = TextPrimary,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "Снимок",
                            fontSize = 12.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    LiquidGlassButton(
                        onClick = { onToggleLiveStreaming(!isLiveStreaming) },
                        isStrong = isLiveStreaming,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "Трансляция экрана",
                            tint = if (isLiveStreaming) StatusOnline else TextPrimary,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = if (isLiveStreaming) "Стоп" else "Стрим",
                            fontSize = 12.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                    }

                    LiquidGlassButton(
                        onClick = { onToggleAudioStream(!isAudioStreamEnabled) },
                        isStrong = isAudioStreamEnabled,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(
                            imageVector = if (isAudioStreamEnabled) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                            contentDescription = "Звук компьютера",
                            tint = if (isAudioStreamEnabled) Color(0xFFD97706) else TextPrimary,
                            modifier = Modifier.size(15.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = if (isAudioStreamEnabled) "Звук ВКЛ" else "Звук ВЫКЛ",
                            fontSize = 12.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Тачпад и мышь",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(14.dp))

        LiquidGlassCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Чувствительность",
                        fontSize = 11.sp,
                        color = TextMuted
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(1.0f to "1.0x", 1.6f to "1.6x", 2.4f to "2.4x").forEach { (factor, label) ->
                            LiquidGlassButton(
                                onClick = { touchpadSensitivity = factor },
                                isStrong = abs(touchpadSensitivity - factor) < 0.05f,
                                shape = RoundedCornerShape(10.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                            ) {
                                Text(label, fontSize = 11.sp, color = TextPrimary)
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                val currentMove by rememberUpdatedState(onMouseMove)
                val currentClick by rememberUpdatedState(onMouseClick)
                val currentScroll by rememberUpdatedState(onMouseScroll)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(GlassWhiteLight)
                        .border(1.dp, GlassBorderTopLight, RoundedCornerShape(16.dp))
                        .pointerInput(touchpadSensitivity) {
                            val touchSlop = viewConfiguration.touchSlop
                            awaitEachGesture {
                                val firstDown = awaitFirstDown(requireUnconsumed = false)
                                val downTime = System.currentTimeMillis()
                                val startPos = firstDown.position
                                var maxPointers = 1
                                var dragged = false
                                var accX = 0f
                                var accY = 0f
                                var accScroll = 0f

                                while (true) {
                                    val event = awaitPointerEvent()
                                    val pressed = event.changes.filter { it.pressed }
                                    if (pressed.size > maxPointers) maxPointers = pressed.size
                                    if (pressed.isEmpty()) break

                                    if (pressed.size >= 2) {
                                        val avgDy = pressed.map { it.positionChange().y }.average().toFloat()
                                        if (abs(avgDy) > 0.5f) {
                                            dragged = true
                                            accScroll += avgDy / 28f
                                            val steps = accScroll.toInt()
                                            if (steps != 0) {
                                                accScroll -= steps
                                                currentScroll(steps)
                                            }
                                            pressed.forEach { it.consume() }
                                        }
                                    } else {
                                        val change = pressed.first()
                                        val delta = change.positionChange()
                                        if (!dragged && (change.position - startPos).getDistance() > touchSlop) {
                                            dragged = true
                                        }
                                        if (dragged && delta != Offset.Zero) {
                                            accX += delta.x * touchpadSensitivity
                                            accY += delta.y * touchpadSensitivity
                                            val ix = accX.toInt()
                                            val iy = accY.toInt()
                                            if (ix != 0 || iy != 0) {
                                                accX -= ix
                                                accY -= iy
                                                currentMove(ix, iy)
                                            }
                                            change.consume()
                                        }
                                    }
                                }

                                val elapsed = System.currentTimeMillis() - downTime
                                if (!dragged) {
                                    when {
                                        maxPointers >= 2 -> currentClick("right")
                                        elapsed >= 450L -> currentClick("right")
                                        else -> currentClick("left")
                                    }
                                }
                            }
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.Computer,
                            contentDescription = "Тачпад",
                            tint = TextMuted,
                            modifier = Modifier.size(32.dp)
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "1 палец — курсор и тап (ЛКМ)\n2 пальца — скролл и тап (ПКМ)",
                            fontSize = 12.sp,
                            color = TextMuted,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LiquidGlassButton(
                        onClick = { onMouseClick("left") },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("ЛКМ", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }

                    LiquidGlassButton(
                        onClick = { onMouseScroll(1) },
                        modifier = Modifier.weight(0.7f)
                    ) {
                        Text("▲", fontSize = 13.sp)
                    }

                    LiquidGlassButton(
                        onClick = { onMouseScroll(-1) },
                        modifier = Modifier.weight(0.7f)
                    ) {
                        Text("▼", fontSize = 13.sp)
                    }

                    LiquidGlassButton(
                        onClick = { onMouseClick("right") },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("ПКМ", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                fun consumeModifiers(): List<String> = buildList {
                    if (ctrlActive) add("CTRL")
                    if (altActive) add("ALT")
                    if (shiftActive) add("SHIFT")
                    if (winActive) add("WIN")
                }.also {
                    ctrlActive = false
                    altActive = false
                    shiftActive = false
                    winActive = false
                }

                fun submitKeyboardText() {
                    val textToSend = keyboardDraft
                    val mods = consumeModifiers()
                    if (textToSend.isEmpty()) {
                        onSendKey("ENTER", mods)
                    } else if (mods.isNotEmpty() && textToSend.length == 1) {
                        onSendKey(textToSend, mods)
                        keyboardDraft = ""
                    } else {
                        onSendText(textToSend)
                        keyboardDraft = ""
                    }
                }

                Text(
                    text = "Клавиатура ПК",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Medium,
                    color = TextMuted
                )
                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    OutlinedTextField(
                        value = keyboardDraft,
                        onValueChange = { keyboardDraft = it },
                        placeholder = { Text("Введите текст…", fontSize = 12.sp, color = TextMuted) },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                        keyboardActions = KeyboardActions(onSend = { submitKeyboardText() }),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = GlassBorderTopLight,
                            unfocusedBorderColor = GlassWhiteMedium
                        )
                    )
                    LiquidGlassButton(
                        onClick = { submitKeyboardText() },
                        isStrong = true,
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 16.dp)
                    ) {
                        Text("Ввод", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TextPrimary)
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        Triple("Ctrl", ctrlActive) { ctrlActive = !ctrlActive },
                        Triple("Alt", altActive) { altActive = !altActive },
                        Triple("Shift", shiftActive) { shiftActive = !shiftActive },
                        Triple("Win", winActive) { winActive = !winActive }
                    ).forEach { (label, active, toggle) ->
                        LiquidGlassButton(
                            onClick = toggle,
                            isStrong = active,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)
                        ) {
                            Text(
                                label,
                                fontSize = 11.sp,
                                color = if (active) AetherViolet else TextPrimary,
                                fontWeight = if (active) FontWeight.Bold else FontWeight.Medium
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        "Esc" to "ESC",
                        "Tab" to "TAB",
                        "Пробел" to "SPACE",
                        "⌫" to "BACK",
                        "↵" to "ENTER"
                    ).forEach { (label, code) ->
                        LiquidGlassButton(
                            onClick = { onSendKey(code, consumeModifiers()) },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)
                        ) {
                            Text(label, fontSize = 11.sp, color = TextPrimary, maxLines = 1)
                        }
                    }
                }

                Spacer(modifier = Modifier.height(6.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(
                        "◀" to "LEFT",
                        "▲" to "UP",
                        "▼" to "DOWN",
                        "▶" to "RIGHT",
                        "Del" to "DELETE"
                    ).forEach { (label, code) ->
                        LiquidGlassButton(
                            onClick = { onSendKey(code, consumeModifiers()) },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)
                        ) {
                            Text(label, fontSize = 11.sp, color = TextPrimary, maxLines = 1)
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Управление окнами",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(14.dp))

        LiquidGlassCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Закрыть активное окно",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = systemStats.activeWindow,
                        fontSize = 12.sp,
                        color = TextMuted
                    )
                }

                Spacer(modifier = Modifier.width(12.dp))

                LiquidGlassButton(
                    onClick = { showCloseWindowConfirmDialog = true },
                    isStrong = true
                ) {
                    Icon(
                        imageVector = Icons.Default.Close,
                        contentDescription = null,
                        tint = TextPrimary,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Alt + F4", fontSize = 13.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(120.dp))
    }

    if (showFullscreenScreenshot && screenshotBitmap != null) {
        Dialog(onDismissRequest = { showFullscreenScreenshot = false }) {
            LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Просмотр экрана ПК",
                            fontFamily = FontFamily.Serif,
                            fontStyle = FontStyle.Italic,
                            fontSize = 20.sp,
                            color = TextPrimary
                        )
                        Box(
                            modifier = Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(GlassWhiteMedium)
                                .clickable { showFullscreenScreenshot = false },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Закрыть просмотр",
                                tint = TextPrimary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    Image(
                        bitmap = screenshotBitmap.asImageBitmap(),
                        contentDescription = "Полный снимок экрана",
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp)),
                        contentScale = ContentScale.Fit
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidGlassButton(
                            onClick = {
                                val bmpSnapshot = screenshotBitmap
                                ioScope.launch {
                                    val saved = withContext(Dispatchers.IO) {
                                        runCatching {
                                            val fileName = "Aether_Screenshot_${System.currentTimeMillis()}.png"
                                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                                val resolver = context.contentResolver
                                                val contentValues = ContentValues().apply {
                                                    put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
                                                    put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
                                                    put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Aether")
                                                    put(MediaStore.Images.Media.IS_PENDING, 1)
                                                }
                                                val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                                                    ?: throw IllegalStateException("Не удалось создать снимок")
                                                resolver.openOutputStream(uri)?.use { out ->
                                                    if (!bmpSnapshot.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IllegalStateException("Не удалось записать снимок")
                                                } ?: throw IllegalStateException("Не удалось открыть снимок")
                                                resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                                            } else {
                                                val publicPics = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "Aether")
                                                val directory = if (publicPics.exists() || publicPics.mkdirs()) {
                                                    publicPics
                                                } else {
                                                    File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Aether").also {
                                                        if (!it.exists() && !it.mkdirs()) throw IllegalStateException("Не удалось создать папку")
                                                    }
                                                }
                                                val target = File(directory, fileName)
                                                target.outputStream().use { out ->
                                                    if (!bmpSnapshot.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IllegalStateException("Не удалось записать снимок")
                                                }
                                                MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf("image/png"), null)
                                            }
                                        }
                                    }
                                    if (saved.isSuccess) {
                                        Toast.makeText(context, "Снимок сохранен", Toast.LENGTH_SHORT).show()
                                    } else {
                                        Toast.makeText(context, "Ошибка сохранения", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(imageVector = Icons.Default.Download, contentDescription = "Сохранить снимок", tint = TextPrimary)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Сохранить", fontSize = 12.sp)
                        }

                        LiquidGlassButton(
                            onClick = {
                                val bmpSnapshot = screenshotBitmap
                                ioScope.launch {
                                    val shareFile = withContext(Dispatchers.IO) {
                                        runCatching {
                                            val cachePath = File(context.cacheDir, "images")
                                            cachePath.mkdirs()
                                            val file = File(cachePath, "shared_image.png")
                                            FileOutputStream(file).use { stream ->
                                                if (!bmpSnapshot.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                                                    throw IllegalStateException("Не удалось сжать снимок")
                                                }
                                            }
                                            file
                                        }.getOrNull()
                                    }
                                    if (shareFile == null) {
                                        Toast.makeText(context, "Ошибка подготовки снимка", Toast.LENGTH_SHORT).show()
                                        return@launch
                                    }
                                    runCatching {
                                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", shareFile)
                                        val shareIntent = Intent().apply {
                                            action = Intent.ACTION_SEND
                                            putExtra(Intent.EXTRA_STREAM, uri)
                                            type = "image/png"
                                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                        }
                                        context.startActivity(Intent.createChooser(shareIntent, "Поделиться снимком"))
                                    }.onFailure {
                                        Toast.makeText(context, "Нет приложения для отправки снимка", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(imageVector = Icons.Default.Share, contentDescription = "Поделиться снимком", tint = TextPrimary)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Поделиться", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }

    if (fullscreenStreamState.isFullscreen && screenshotBitmap != null && isLiveStreaming) {
        StreamFullscreenOverlay(
            bitmap = screenshotBitmap,
            state = fullscreenStreamState,
            onTapScreen = onTapScreen,
            onLongPressScreen = onLongPressScreen,
            onExit = fullscreenStreamState::exit,
            onStop = {
                fullscreenStreamState.exit()
                onToggleLiveStreaming(false)
            }
        )
    }

    if (showCloseWindowConfirmDialog) {
        Dialog(onDismissRequest = { showCloseWindowConfirmDialog = false }) {
            LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        text = "Подтверждение",
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 22.sp,
                        color = TextPrimary
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Вы уверены, что хотите закрыть текущее окно (${systemStats.activeWindow})?",
                        fontSize = 14.sp,
                        color = TextMuted,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidGlassButton(
                            onClick = { showCloseWindowConfirmDialog = false },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Отмена", fontSize = 13.sp)
                        }

                        LiquidGlassButton(
                            onClick = {
                                showCloseWindowConfirmDialog = false
                                onCloseActiveWindow()
                            },
                            isStrong = true,
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Закрыть Alt+F4", fontSize = 13.sp, color = TextPrimary)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StreamFullscreenOverlay(
    bitmap: Bitmap,
    state: StreamFullscreenState,
    onTapScreen: (Float, Float) -> Unit,
    onLongPressScreen: (Float, Float) -> Unit,
    onExit: () -> Unit,
    onStop: () -> Unit
) {
    val activity = LocalContext.current.findActivity()
    BackHandler(onBack = onExit)

    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var containerSize by remember { mutableStateOf(IntSize.Zero) }
    var touchClickMode by rememberSaveable { mutableStateOf(true) }
    val currentBitmap by rememberUpdatedState(bitmap)

    fun mapOffsetToNormalized(offset: Offset): Pair<Float, Float>? {
        val w = containerSize.width.toFloat()
        val h = containerSize.height.toFloat()
        val bmp = currentBitmap
        val bw = bmp.width.toFloat()
        val bh = bmp.height.toFloat()
        if (w <= 0f || h <= 0f || bw <= 0f || bh <= 0f) return null
        val fitScale = min(w / bw, h / bh)
        val renderedW = bw * fitScale
        val renderedH = bh * fitScale
        val imgLeft = (w - renderedW) / 2f
        val imgTop = (h - renderedH) / 2f
        val unscaledX = (offset.x - w / 2f - pan.x) / zoom + w / 2f
        val unscaledY = (offset.y - h / 2f - pan.y) / zoom + h / 2f
        val normX = (unscaledX - imgLeft) / renderedW
        val normY = (unscaledY - imgTop) / renderedH
        if (normX !in 0f..1f || normY !in 0f..1f) return null
        return normX to normY
    }

    LaunchedEffect(state.controlsVisible) {
        if (state.controlsVisible) {
            delay(3_000)
            state.hideControls()
        }
    }

    Dialog(
        onDismissRequest = onExit,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        val dialogWindow = (LocalView.current.parent as? DialogWindowProvider)?.window
        DisposableEffect(activity, dialogWindow) {
            val controller = dialogWindow?.let { WindowCompat.getInsetsController(it, it.decorView) }
            val previousOrientation = activity?.requestedOrientation
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            dialogWindow?.let { WindowCompat.setDecorFitsSystemWindows(it, false) }
            controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller?.hide(WindowInsetsCompat.Type.systemBars())
            onDispose {
                controller?.show(WindowInsetsCompat.Type.systemBars())
                dialogWindow?.let { WindowCompat.setDecorFitsSystemWindows(it, true) }
                if (previousOrientation != null) activity?.requestedOrientation = previousOrientation
            }
        }

        val currentTapScreen by rememberUpdatedState(onTapScreen)
        val currentLongPressScreen by rememberUpdatedState(onLongPressScreen)

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .onSizeChanged { containerSize = it }
                .pointerInput(Unit) {
                    detectTransformGestures { _, panChange, zoomChange, _ ->
                        val newZoom = (zoom * zoomChange).coerceIn(1f, 4f)
                        zoom = newZoom
                        if (newZoom <= 1.01f) {
                            pan = Offset.Zero
                        } else {
                            val maxPanX = (containerSize.width * (newZoom - 1f)) / 2f
                            val maxPanY = (containerSize.height * (newZoom - 1f)) / 2f
                            pan = Offset(
                                x = (pan.x + panChange.x).coerceIn(-maxPanX, maxPanX),
                                y = (pan.y + panChange.y).coerceIn(-maxPanY, maxPanY)
                            )
                        }
                    }
                }
                .pointerInput(touchClickMode) {
                    detectTapGestures(
                        onTap = { pos ->
                            if (touchClickMode) {
                                mapOffsetToNormalized(pos)?.let { (nx, ny) ->
                                    currentTapScreen(nx, ny)
                                }
                            } else {
                                if (state.controlsVisible) state.hideControls() else state.showControls()
                            }
                        },
                        onDoubleTap = {
                            if (state.controlsVisible) state.hideControls() else state.showControls()
                        },
                        onLongPress = { pos ->
                            if (touchClickMode) {
                                mapOffsetToNormalized(pos)?.let { (nx, ny) ->
                                    currentLongPressScreen(nx, ny)
                                }
                            } else {
                                state.showControls()
                            }
                        }
                    )
                },
            contentAlignment = Alignment.Center
        ) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Полноэкранная трансляция ПК",
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer(
                        scaleX = zoom,
                        scaleY = zoom,
                        translationX = pan.x,
                        translationY = pan.y
                    ),
                contentScale = ContentScale.Fit
            )
            AnimatedVisibility(
                visible = state.controlsVisible,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopEnd)
            ) {
                Row(
                    modifier = Modifier.padding(18.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LiquidGlassButton(
                        onClick = { touchClickMode = !touchClickMode },
                        isStrong = touchClickMode
                    ) {
                        Text(if (touchClickMode) "Тап: Клик" else "Тап: Панель", color = TextPrimary, fontSize = 12.sp)
                    }
                    if (zoom > 1.05f) {
                        LiquidGlassButton(onClick = { zoom = 1f; pan = Offset.Zero }) {
                            Text("${(zoom * 10f).roundToInt() / 10f}x", color = TextPrimary, fontSize = 12.sp)
                        }
                    }
                    LiquidGlassButton(onClick = onStop) { Text("Остановить", color = TextPrimary, fontSize = 12.sp) }
                    LiquidGlassButton(onClick = onExit) {
                        Icon(Icons.Default.Close, contentDescription = "Выйти из полного экрана", tint = TextPrimary)
                    }
                }
            }
            if (!state.controlsVisible) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(14.dp)
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color.Black.copy(alpha = 0.45f))
                        .clickable { state.showControls() },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Default.Fullscreen, contentDescription = "Показать панель", tint = Color.White.copy(alpha = 0.75f), modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}
