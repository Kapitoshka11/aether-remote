package com.example.ui.components

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.material3.LocalContentColor
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.ConnectionStatus
import com.example.ui.theme.GlassBorderBottomLight
import com.example.ui.theme.GlassBorderBottomStrong
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassBorderTopStrong
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.GlassWhiteStrong
import com.example.ui.theme.GlassWhiteUltraThin
import com.example.ui.theme.StatusConnecting
import com.example.ui.theme.StatusOffline
import com.example.ui.theme.StatusOnline
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import com.example.ui.theme.PitchBlack
import com.example.ui.theme.AetherAmber
import com.example.ui.theme.AetherViolet

@Composable
fun AetherBackdrop(modifier: Modifier = Modifier) {
    val backgroundColor = PitchBlack
    val ambient = rememberInfiniteTransition(label = "aetherAmbient")
    val drift by ambient.animateFloat(
        initialValue = -0.04f,
        targetValue = 0.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 12_000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "aetherAmbientDrift"
    )
    Canvas(modifier = modifier) {
        drawRect(backgroundColor)
        val step = 52.dp.toPx()
        var x = 0f
        while (x <= size.width) {
            drawLine(AetherAmber.copy(alpha = 0.035f), start = androidx.compose.ui.geometry.Offset(x, 0f), end = androidx.compose.ui.geometry.Offset(x, size.height), strokeWidth = 1f)
            x += step
        }
        var y = 0f
        while (y <= size.height) {
            drawLine(AetherAmber.copy(alpha = 0.035f), start = androidx.compose.ui.geometry.Offset(0f, y), end = androidx.compose.ui.geometry.Offset(size.width, y), strokeWidth = 1f)
            y += step
        }
        val violetCenter = androidx.compose.ui.geometry.Offset(size.width * (0.78f + drift), size.height * (0.12f + drift))
        drawCircle(
            brush = Brush.radialGradient(listOf(AetherViolet.copy(alpha = 0.42f), AetherViolet.copy(alpha = 0.12f), Color.Transparent), violetCenter, size.minDimension * 0.82f),
            radius = size.minDimension * 0.82f,
            center = violetCenter
        )
        val amberCenter = androidx.compose.ui.geometry.Offset(size.width * (0.16f - drift), size.height * (0.82f - drift))
        drawCircle(
            brush = Brush.radialGradient(listOf(AetherAmber.copy(alpha = 0.2f), Color.Transparent), amberCenter, size.minDimension * 0.7f),
            radius = size.minDimension * 0.7f,
            center = amberCenter
        )
        val grainStep = 13.dp.toPx()
        var grainY = 0f
        var row = 0
        while (grainY < size.height) {
            var grainX = if (row % 2 == 0) 0f else grainStep * 0.5f
            while (grainX < size.width) {
                drawCircle(
                    color = Color.White.copy(alpha = if ((row + (grainX / grainStep).toInt()) % 3 == 0) 0.018f else 0.009f),
                    radius = 0.65f,
                    center = androidx.compose.ui.geometry.Offset(grainX, grainY)
                )
                grainX += grainStep
            }
            grainY += grainStep
            row++
        }
    }
}


@Composable
fun LiquidGlassCard(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(20.dp),
    content: @Composable BoxScope.() -> Unit
) {
    val borderBrush = Brush.verticalGradient(
        colors = listOf(
            GlassBorderTopLight,
            Color.Transparent,
            GlassBorderBottomLight
        )
    )

    Box(
        modifier = modifier
            .clip(shape)
            .background(GlassWhiteUltraThin)
            .border(width = 1.4.dp, brush = borderBrush, shape = shape)
    ) {
        CompositionLocalProvider(LocalContentColor provides TextPrimary) {
            content()
        }
    }
}

@Composable
fun LiquidGlassStrongCard(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(32.dp),
    content: @Composable BoxScope.() -> Unit
) {
    val borderBrush = Brush.verticalGradient(
        colors = listOf(
            GlassBorderTopStrong,
            GlassWhiteLight,
            GlassBorderBottomStrong
        )
    )

    Box(
        modifier = modifier
            .clip(shape)
            .background(GlassWhiteLight)
            .border(width = 1.6.dp, brush = borderBrush, shape = shape)
    ) {
        CompositionLocalProvider(LocalContentColor provides TextPrimary) {
            content()
        }
    }
}

@Composable
fun LiquidGlassButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(9999.dp),
    enabled: Boolean = true,
    isStrong: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 14.dp),
    content: @Composable RowScope.() -> Unit
) {
    val context = LocalContext.current
    val vibrator = remember {
        try {
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        } catch (_: Exception) {
            null
        }
    }

    val scale = remember { Animatable(1f) }

    val borderBrush = Brush.verticalGradient(
        colors = if (isStrong) listOf(
            GlassBorderTopStrong,
            Color.Transparent,
            GlassBorderBottomStrong
        ) else listOf(
            GlassBorderTopLight,
            Color.Transparent,
            GlassBorderBottomLight
        )
    )

    val bg = if (isStrong) GlassWhiteMedium else GlassWhiteLight
    val contentColor = TextPrimary.copy(alpha = if (enabled) 1f else 0.48f)

    Box(
        modifier = modifier
            .scale(scale.value)
            .clip(shape)
            .background(if (enabled) bg else GlassWhiteUltraThin)
            .border(width = 1.4.dp, brush = borderBrush, shape = shape)
            .clickable(
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null
            ) {
                vibrator?.let {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        it.vibrate(VibrationEffect.createOneShot(20, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        it.vibrate(20)
                    }
                }
                onClick()
            }
            .padding(contentPadding),
        contentAlignment = Alignment.Center
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            CompositionLocalProvider(LocalContentColor provides contentColor) {
                content()
            }
        }
    }
}

@Composable
fun GlassCircularProgress(
    percentage: Float,
    label: String,
    icon: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    meterColor: Color = Color.White
) {
    val animatedPercentage by animateFloatAsState(
        targetValue = percentage,
        animationSpec = tween(durationMillis = 800, easing = FastOutSlowInEasing),
        label = "percentage"
    )

    LiquidGlassCard(
        modifier = modifier.padding(4.dp),
        shape = RoundedCornerShape(24.dp)
    ) {
        Box(
            modifier = Modifier
                .padding(18.dp)
        ) {
            Canvas(modifier = Modifier.size(110.dp).align(Alignment.Center)) {
                val strokeWidth = 8.dp.toPx()
                drawCircle(
                    color = Color.White.copy(alpha = 0.08f),
                    style = Stroke(width = strokeWidth)
                )
                val sweep = (animatedPercentage / 100f) * 360f
                drawArc(
                    color = meterColor,
                    startAngle = -90f,
                    sweepAngle = sweep,
                    useCenter = false,
                    style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
                )
            }

            Box(
                modifier = Modifier
                    .size(110.dp)
                    .align(Alignment.Center),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "${animatedPercentage.toInt()}%",
                    fontFamily = FontFamily.Serif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 28.sp,
                    color = TextPrimary,
                    fontWeight = FontWeight.Bold
                )
            }
        }
    }
}

@Composable
fun StatusBadge(
    status: ConnectionStatus,
    hostName: String,
    modifier: Modifier = Modifier,
    transport: String = "lan"
) {
    val dotColor = when (status) {
        ConnectionStatus.CONNECTED -> StatusOnline
        ConnectionStatus.CONNECTING, ConnectionStatus.AWAITING_APPROVAL, ConnectionStatus.RECONNECTING -> StatusConnecting
        ConnectionStatus.DISCONNECTED -> StatusOffline
    }

    val statusText = when (status) {
        ConnectionStatus.CONNECTED -> if (transport == "relay") "ЧЕРЕЗ ИНТЕРНЕТ" else "ПОДКЛЮЧЕНО"
        ConnectionStatus.CONNECTING -> "ПОДКЛЮЧЕНИЕ..."
        ConnectionStatus.AWAITING_APPROVAL -> "ЗАПРОС ОТПРАВЛЕН НА ПК"
        ConnectionStatus.RECONNECTING -> "ПЕРЕПОДКЛЮЧЕНИЕ..."
        ConnectionStatus.DISCONNECTED -> "ОФФЛАЙН"
    }

    val alphaPulse = remember { Animatable(0.4f) }
    LaunchedEffect(status) {
        if (status == ConnectionStatus.CONNECTING || status == ConnectionStatus.AWAITING_APPROVAL || status == ConnectionStatus.RECONNECTING) {
            alphaPulse.animateTo(
                targetValue = 1f,
                animationSpec = infiniteRepeatable(
                    animation = tween(600, easing = LinearEasing),
                    repeatMode = RepeatMode.Reverse
                )
            )
        } else {
            alphaPulse.snapTo(1f)
        }
    }

    LiquidGlassCard(
        modifier = modifier,
        shape = RoundedCornerShape(9999.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(dotColor.copy(alpha = alphaPulse.value))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "$statusText • $hostName",
                maxLines = 1,
                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                fontSize = 12.sp,
                fontFamily = FontFamily.SansSerif,
                fontWeight = FontWeight.Medium,
                color = TextSecondary
            )
        }
    }
}

@Composable
fun GlassShimmerLoader(
    modifier: Modifier = Modifier
) {
    val shimmerAlpha = remember { Animatable(0.1f) }
    LaunchedEffect(Unit) {
        shimmerAlpha.animateTo(
            targetValue = 0.35f,
            animationSpec = infiniteRepeatable(
                animation = tween(800, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            )
        )
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(16.dp))
            .background(GlassWhiteStrong.copy(alpha = shimmerAlpha.value))
            .border(
                1.dp,
                GlassBorderTopLight,
                RoundedCornerShape(16.dp)
            )
    )
}
