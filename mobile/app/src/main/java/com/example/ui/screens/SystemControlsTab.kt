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
import androidx.compose.material3.Surface
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import kotlinx.coroutines.delay
import com.example.model.SystemStats
import com.example.ui.components.GlassCircularProgress
import com.example.ui.components.GlassShimmerLoader
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary

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
    onCloseActiveWindow: () -> Unit
) {
    val context = LocalContext.current
    var showFullscreenScreenshot by remember { mutableStateOf(false) }
    var showCloseWindowConfirmDialog by remember { mutableStateOf(false) }
    val fullscreenStreamState = remember { StreamFullscreenState() }

    LaunchedEffect(isLiveStreaming, screenshotBitmap) {
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
                        tint = Color.White,
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
                        tint = Color.White,
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
                                    tint = if (isSelected) Color.Cyan else Color.White,
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
                            tint = Color.White,
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
                            tint = if (isLiveStreaming) Color.Green else Color.White,
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
                            tint = if (isAudioStreamEnabled) Color.Yellow else Color.White,
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
                        tint = Color.White,
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
                                tint = Color.White,
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
                                try {
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
                                            if (!screenshotBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IllegalStateException("Не удалось записать снимок")
                                        } ?: throw IllegalStateException("Не удалось открыть снимок")
                                        resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                                    } else {
                                        val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Aether")
                                        if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Не удалось создать папку")
                                        File(directory, fileName).outputStream().use { out ->
                                            if (!screenshotBitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IllegalStateException("Не удалось записать снимок")
                                        }
                                    }
                                    Toast.makeText(context, "Снимок сохранен", Toast.LENGTH_SHORT).show()
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Ошибка сохранения", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(imageVector = Icons.Default.Download, contentDescription = "Сохранить снимок", tint = Color.White)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Сохранить", fontSize = 12.sp)
                        }

                        LiquidGlassButton(
                            onClick = {
                                try {
                                    val cachePath = File(context.cacheDir, "images")
                                    cachePath.mkdirs()
                                    val file = File(cachePath, "shared_image.png")
                                    val stream = FileOutputStream(file)
                                    screenshotBitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
                                    stream.close()
                                    
                                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                                    val shareIntent = Intent().apply {
                                        action = Intent.ACTION_SEND
                                        putExtra(Intent.EXTRA_STREAM, uri)
                                        type = "image/png"
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    }
                                    context.startActivity(Intent.createChooser(shareIntent, "Поделиться снимком"))
                                } catch (e: Exception) {
                                    Toast.makeText(context, "Ошибка", Toast.LENGTH_SHORT).show()
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(imageVector = Icons.Default.Share, contentDescription = "Поделиться снимком", tint = Color.White)
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
    onExit: () -> Unit,
    onStop: () -> Unit
) {
    val activity = LocalContext.current.findActivity()
    BackHandler(onBack = onExit)

    LaunchedEffect(state.controlsVisible) {
        if (state.controlsVisible) {
            delay(2_500)
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

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .clickable { if (state.controlsVisible) state.hideControls() else state.showControls() },
            contentAlignment = Alignment.Center
        ) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Полноэкранная трансляция ПК",
                modifier = Modifier.fillMaxSize(),
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
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    LiquidGlassButton(onClick = onStop) { Text("Остановить стрим", color = Color.White) }
                    LiquidGlassButton(onClick = onExit) {
                        Icon(Icons.Default.Close, contentDescription = "Выйти из полного экрана", tint = Color.White)
                    }
                }
            }
        }
    }
}
