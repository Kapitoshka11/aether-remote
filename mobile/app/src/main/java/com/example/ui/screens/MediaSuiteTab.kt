package com.example.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.VolumeDown
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.MediaState
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

@Composable
fun MediaSuiteTab(
    mediaState: MediaState,
    onVolumeChange: (Int) -> Unit,
    onVolumeStepUp: () -> Unit,
    onVolumeStepDown: () -> Unit,
    onToggleMute: () -> Unit,
    onPlayPause: () -> Unit,
    onNextTrack: () -> Unit,
    onPreviousTrack: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "Громкость и звук",
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
                modifier = Modifier.padding(20.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(GlassWhiteLight)
                                .border(1.dp, GlassBorderTopLight, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = if (mediaState.isMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Громкость",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Medium,
                                color = TextPrimary
                            )
                            Text(
                                text = if (mediaState.isMuted) "Звук отключен" else "${mediaState.volume}%",
                                fontSize = 12.sp,
                                color = TextMuted
                            )
                        }
                    }

                    Text(
                        text = if (mediaState.isMuted) "0%" else "${mediaState.volume}%",
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic,
                        fontSize = 32.sp,
                        color = TextPrimary
                    )
                }

                Spacer(modifier = Modifier.height(20.dp))

                var sliderValue by remember { mutableFloatStateOf(if (mediaState.isMuted) 0f else mediaState.volume.toFloat()) }
                var isDragging by remember { mutableStateOf(false) }
                
                LaunchedEffect(mediaState.volume, mediaState.isMuted) {
                    if (!isDragging) sliderValue = if (mediaState.isMuted) 0f else mediaState.volume.toFloat()
                }

                Slider(
                    value = sliderValue,
                    onValueChange = {
                        isDragging = true
                        sliderValue = it
                    },
                    onValueChangeFinished = {
                        onVolumeChange(sliderValue.toInt())
                        isDragging = false
                    },
                    valueRange = 0f..100f,
                    colors = SliderDefaults.colors(
                        thumbColor = Color.White,
                        activeTrackColor = Color.White,
                        inactiveTrackColor = GlassWhiteMedium
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    LiquidGlassButton(
                        onClick = onVolumeStepDown,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(imageVector = Icons.Default.VolumeDown, contentDescription = "Уменьшить громкость", tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("-5%", fontSize = 12.sp)
                    }

                    LiquidGlassButton(
                        onClick = onVolumeStepUp,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(imageVector = Icons.Default.VolumeUp, contentDescription = "Увеличить громкость", tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("+5%", fontSize = 12.sp)
                    }

                    LiquidGlassButton(
                        onClick = onToggleMute,
                        isStrong = mediaState.isMuted,
                        modifier = Modifier.weight(1.2f)
                    ) {
                        Icon(
                            imageVector = if (mediaState.isMuted) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                            contentDescription = "Выключить звук",
                            tint = Color.White,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (mediaState.isMuted) "Включить" else "Мут", fontSize = 12.sp)
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            text = "Медиаплеер ПК",
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
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(GlassWhiteLight)
                        .border(1.dp, GlassBorderTopLight, RoundedCornerShape(20.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.MusicNote,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(36.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = mediaState.trackTitle.ifBlank { "Нет активного воспроизведения" },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = TextPrimary,
                    maxLines = 1
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = mediaState.artistName,
                    fontSize = 13.sp,
                    color = TextMuted,
                    maxLines = 1
                )

                Spacer(modifier = Modifier.height(24.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    LiquidGlassButton(
                        onClick = onPreviousTrack,
                        shape = CircleShape
                    ) {
                        Icon(
                            imageVector = Icons.Default.SkipPrevious,
                            contentDescription = "Предыдущий трек",
                            tint = Color.White,
                            modifier = Modifier.size(24.dp)
                        )
                    }

                    LiquidGlassButton(
                        onClick = onPlayPause,
                        isStrong = true,
                        shape = CircleShape,
                        modifier = Modifier.size(64.dp)
                    ) {
                        Icon(
                            imageVector = if (mediaState.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = "Воспроизведение или пауза",
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }

                    LiquidGlassButton(
                        onClick = onNextTrack,
                        shape = CircleShape
                    ) {
                        Icon(
                            imageVector = Icons.Default.SkipNext,
                            contentDescription = "Следующий трек",
                            tint = Color.White,
                            modifier = Modifier.size(24.dp)
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(120.dp))
    }
}
