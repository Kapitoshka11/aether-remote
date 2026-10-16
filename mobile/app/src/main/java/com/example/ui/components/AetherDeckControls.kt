package com.example.ui.components

import android.graphics.Color.parseColor
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.ToggleOn
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.decode.GifDecoder
import coil.decode.ImageDecoderDecoder
import coil.decode.SvgDecoder
import coil.request.ImageRequest
import com.example.aetherdeck.DeckControl
import com.example.ui.theme.AetherViolet
import kotlin.math.abs
import kotlin.math.round
import kotlin.math.roundToInt

private fun color(value: String, fallback: Color) = try { Color(parseColor(value)) } catch (_: Exception) { fallback }

private fun statusValue(control: DeckControl, value: Any?): String {
    if (value == null || value.toString().isBlank()) return "Нет данных"
    return when (control.stateBinding) {
        "audio.volume", "system.cpu", "system.ram" -> "${(value as? Number)?.toInt() ?: value}%"
        "audio.muted" -> if (value == true) "Выключен" else "Включён"
        "media.playing" -> if (value == true) "Воспроизведение" else "Пауза"
        "obs.connected", "obs.streaming", "obs.recording", "stream.screen" -> if (value == true) "Запущен" else "Выключен"
        else -> value.toString()
    }
}

private fun icon(control: DeckControl): ImageVector = when (control.iconName) {
    "sparkles" -> Icons.Default.AutoAwesome
    "play" -> Icons.Default.PlayArrow
    "volume" -> Icons.Default.VolumeUp
    "power" -> Icons.Default.PowerSettingsNew
    "folder" -> Icons.Default.Folder
    "obs" -> Icons.Default.Videocam
    "terminal" -> Icons.Default.Terminal
    else -> when (control.type) {
        "toggle" -> Icons.Default.ToggleOn
        "slider" -> Icons.Default.Tune
        "folder" -> Icons.Default.Folder
        "status" -> Icons.Default.Visibility
        else -> Icons.Default.Bolt
    }
}

internal fun snapDeckSliderValue(value: Double, minimum: Double, maximum: Double, step: Double): Double {
    if (!value.isFinite() || !minimum.isFinite() || !maximum.isFinite() || maximum <= minimum) return minimum
    val safeStep = step.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
    return (minimum + round((value.coerceIn(minimum, maximum) - minimum) / safeStep) * safeStep)
        .coerceIn(minimum, maximum)
}

@Composable
fun AetherDeckAssetImage(
    hash: String?,
    asset: Pair<String, ByteArray>?,
    onMissingAsset: (String) -> Unit,
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    contentScale: ContentScale = ContentScale.Fit
) {
    LaunchedEffect(hash, asset) {
        if (hash != null && asset == null) onMissingAsset(hash)
    }
    asset?.let { (mimeType, bytes) ->
        val context = LocalContext.current
        val imageRequest = remember(hash, mimeType, bytes.size) {
            ImageRequest.Builder(context)
                .data(bytes)
                .memoryCacheKey(hash)
                .apply {
                    when (mimeType) {
                        "image/svg+xml" -> decoderFactory(SvgDecoder.Factory())
                        "image/gif" -> decoderFactory(
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ImageDecoderDecoder.Factory() else GifDecoder.Factory()
                        )
                    }
                }
                .build()
        }
        AsyncImage(model = imageRequest, contentDescription = contentDescription, contentScale = contentScale, modifier = modifier)
    }
}

@Composable
fun AetherDeckControl(
    control: DeckControl,
    state: Map<String, Any?>,
    dynamicValue: Any?,
    asset: Pair<String, ByteArray>?,
    onMissingAsset: (String) -> Unit,
    onTrigger: () -> Unit,
    onSlider: (Double) -> Unit,
    onFolder: () -> Unit
) {
    val background = color(control.background, Color(0xFF17151F))
    val foreground = color(control.foreground, Color.White)
    val active = state["active"] as? Boolean ?: false
    val running = state["running"] as? Boolean ?: false
    val error = state["error"]?.toString()?.takeIf { it.isNotBlank() }
    val action = if (control.type == "folder") onFolder else onTrigger
    val clickable = control.enabled &&
        control.type != "status" &&
        control.type != "slider" &&
        !(control.type == "folder" && control.targetPageId == null)
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val pressedScale by animateFloatAsState(
        targetValue = if (isPressed && clickable) 0.94f else 1f,
        animationSpec = spring(stiffness = 700f),
        label = "deck-control-press"
    )

    LiquidGlassCard(
        modifier = Modifier
            .fillMaxSize()
            .alpha(if (control.enabled) 1f else .42f)
            .scale(pressedScale)
            .semantics {
                stateDescription = when {
                    error != null -> "Ошибка: $error"
                    running -> "Выполняется"
                    !control.enabled -> "Недоступна"
                    control.type == "status" -> statusValue(control, dynamicValue)
                    control.type == "toggle" -> if (active) "Включено" else "Выключено"
                    control.type == "slider" -> "Значение ${(state["value"] as? Number)?.toDouble() ?: control.minimum}"
                    !clickable -> "Недоступна"
                    isPressed -> "Нажата"
                    else -> "Готова"
                }
            }
            .then(if (clickable) Modifier.clickable(interactionSource = interactionSource, indication = null, onClick = action) else Modifier)
            .testTag("deck-control-${control.id}"),
        shape = RoundedCornerShape(20.dp)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(background.copy(alpha = if (active) .35f else .2f), Color.Transparent))),
            contentAlignment = Alignment.Center
        ) {
            if (isPressed && clickable) {
                Box(Modifier.fillMaxSize().background(Color.White.copy(alpha = .12f)))
            }
            if (control.iconKind == "asset") AetherDeckAssetImage(
                hash = control.iconHash,
                asset = asset,
                onMissingAsset = onMissingAsset,
                contentDescription = control.label,
                modifier = Modifier.fillMaxSize().alpha(.72f)
            )
            if (control.type == "slider") {
                val validRange = control.minimum.isFinite() && control.maximum.isFinite() && control.maximum > control.minimum
                val safeMinimum = if (validRange) control.minimum else 0.0
                val safeMaximum = if (validRange) control.maximum else 100.0
                val range = safeMaximum - safeMinimum
                val safeStep = control.step.takeIf { it.isFinite() && it > 0.0 && it <= range } ?: 1.0
                val intervals = (range / safeStep).roundToInt()
                val discreteSteps = if (intervals in 1..1000 && abs(intervals * safeStep - range) < 1e-7) (intervals - 1).coerceAtLeast(0) else 0
                val serverValue = ((state["value"] as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: safeMinimum)
                    .coerceIn(safeMinimum, safeMaximum)
                var value by remember(control.id, safeMinimum, safeMaximum) {
                    mutableDoubleStateOf(serverValue)
                }
                val sliderInteractionSource = remember(control.id) { MutableInteractionSource() }
                val isDragging by sliderInteractionSource.collectIsDraggedAsState()
                LaunchedEffect(serverValue, safeMinimum, safeMaximum, isDragging) {
                    if (!isDragging) value = serverValue
                }
                Column(
                    modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = control.label,
                            color = foreground,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f)
                        )
                        Text(value.toString(), color = foreground, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        if (running) Text("…", color = AetherViolet, fontWeight = FontWeight.Bold)
                        if (error != null) Text("!", color = Color(0xFFF87171), fontWeight = FontWeight.Bold)
                    }
                    if (error != null) {
                        Text(error, color = Color(0xFFF87171), fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Slider(
                        value = value.toFloat(),
                        onValueChange = {
                            value = snapDeckSliderValue(it.toDouble(), safeMinimum, safeMaximum, safeStep)
                        },
                        onValueChangeFinished = {
                            onSlider(value)
                        },
                        valueRange = safeMinimum.toFloat()..safeMaximum.toFloat(),
                        steps = discreteSteps,
                        enabled = control.enabled,
                        interactionSource = sliderInteractionSource,
                        colors = SliderDefaults.colors(
                            thumbColor = AetherViolet,
                            activeTrackColor = AetherViolet,
                            inactiveTrackColor = foreground.copy(alpha = .18f)
                        )
                    )
                }
            } else {
                Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.SpaceBetween) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Icon(icon(control), null, tint = foreground.copy(alpha = .85f))
                        when {
                            running -> Text("…", color = AetherViolet, fontWeight = FontWeight.Bold)
                            error != null -> Text("!", color = Color(0xFFF87171), fontWeight = FontWeight.Bold)
                            control.type == "toggle" -> Text(if (active) "Включено" else "Выключено", color = foreground.copy(alpha = .7f), fontSize = 10.sp, fontWeight = FontWeight.Bold)
                            control.type == "folder" -> Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = foreground.copy(alpha = if (control.targetPageId == null) .3f else .7f))
                            control.type == "status" -> Text("СТАТУС", color = foreground.copy(alpha = .45f), fontSize = 9.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Column {
                        when {
                            control.type == "status" -> Text(statusValue(control, dynamicValue), color = foreground, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            control.type == "folder" && control.targetPageId == null -> Text("Страница не выбрана", color = foreground.copy(alpha = .6f), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            error != null -> Text(error, color = Color(0xFFF87171), fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            else -> dynamicValue?.let { Text(it.toString(), color = foreground, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                        }
                        Text(control.label, color = foreground, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}
