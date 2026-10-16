package com.example.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.example.data.sendSharedContent
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.example.model.ClipboardData
import com.example.data.ClipboardHistoryItem
import com.example.model.FileTransferProgress
import com.example.model.ReceivedFile
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassCard
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.GlassWhiteMedium
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.example.ui.theme.TextSecondary
import java.io.File
import java.net.URLConnection

@Composable
fun ToolsUtilitiesTab(
    clipboardData: ClipboardData,
    clipboardHistory: List<ClipboardHistoryItem> = emptyList(),
    fileTransferProgress: FileTransferProgress? = null,
    receivedFiles: List<ReceivedFile> = emptyList(),
    onReadPcClipboard: () -> Unit,
    onSendToPcClipboard: (String) -> Unit,
    onDeleteClipboardItem: (Long) -> Unit = {},
    onClearClipboardHistory: () -> Unit = {},
    onDisconnect: () -> Unit,
    onSendFileToPc: (fileName: String, fileSize: Long, bytes: ByteArray) -> Unit = { _, _, _ -> },
    onSendFileStreamToPc: (fileName: String, fileSize: Long, inputStream: java.io.InputStream) -> Unit = { _, _, stream -> try { stream.close() } catch (_: Exception) {} }
) {
    val context = LocalContext.current
    var sendClipboardText by remember { mutableStateOf("") }

    fun fileUri(file: ReceivedFile): Uri? {
        val path = file.savedPath ?: return null
        return if (path.startsWith("content://")) {
            Uri.parse(path)
        } else {
            runCatching {
                FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", File(path))
            }.getOrNull()
        }
    }

    fun fileMimeType(file: ReceivedFile, uri: Uri): String =
        context.contentResolver.getType(uri)
            ?: URLConnection.guessContentTypeFromName(file.fileName)
            ?: "application/octet-stream"

    val shareScope = rememberCoroutineScope()
    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { fileUri ->
            shareScope.launch {
                try {
                    val name = sendSharedContent(context, fileUri, onSendFileStreamToPc)
                    Toast.makeText(context, "Отправка $name на ПК...", Toast.LENGTH_SHORT).show()
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    Toast.makeText(context, "Не удалось открыть выбранный файл", Toast.LENGTH_SHORT).show()
                }
            }
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
            text = "Обмен файлами с ПК",
            fontFamily = FontFamily.Serif,
            fontStyle = FontStyle.Italic,
            fontSize = 24.sp,
            color = TextPrimary
        )

        Spacer(modifier = Modifier.height(14.dp))

        LiquidGlassCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.CloudUpload,
                        contentDescription = null,
                        tint = Color.Cyan,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Отправить на ПК",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                LiquidGlassButton(
                    onClick = { filePickerLauncher.launch("*/*") },
                    isStrong = true,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(imageVector = Icons.Default.CloudUpload, contentDescription = "Выбрать файл", tint = Color.White, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Выберите файлы для отправки", fontSize = 14.sp)
                }

                if (fileTransferProgress != null && fileTransferProgress.isUploading) {
                    Spacer(modifier = Modifier.height(14.dp))
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(GlassWhiteLight)
                            .padding(12.dp)
                    ) {
                        Text(
                            text = "Отправка: ${fileTransferProgress.fileName}",
                            fontSize = 12.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = fileTransferProgress.progress,
                            modifier = Modifier.fillMaxWidth(),
                            color = Color.Cyan,
                            trackColor = GlassWhiteMedium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${(fileTransferProgress.progress * 100).toInt()}%",
                            fontSize = 11.sp,
                            color = TextMuted
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(20.dp))

        LiquidGlassCard(
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Default.CloudDownload,
                        contentDescription = null,
                        tint = Color.Green,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        text = "Получено с ПК",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                if (fileTransferProgress != null && !fileTransferProgress.isUploading) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(GlassWhiteLight)
                            .padding(12.dp)
                    ) {
                        Text(
                            text = "Скачивание: ${fileTransferProgress.fileName}",
                            fontSize = 12.sp,
                            color = TextPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = fileTransferProgress.progress,
                            modifier = Modifier.fillMaxWidth(),
                            color = Color.Green,
                            trackColor = GlassWhiteMedium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${(fileTransferProgress.progress * 100).toInt()}%",
                            fontSize = 11.sp,
                            color = TextMuted
                        )
                    }
                    Spacer(modifier = Modifier.height(14.dp))
                }

                if (receivedFiles.isEmpty()) {
                    Text(
                        text = "Полученных файлов нет",
                        fontSize = 12.sp,
                        color = TextMuted
                    )
                } else {
                    receivedFiles.forEach { file ->
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(GlassWhiteLight)
                                .padding(12.dp)
                        ) {
                            Text(
                                text = file.fileName,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary
                            )
                            Text(
                                text = "${(file.fileSize / 1024)} KB",
                                fontSize = 11.sp,
                                color = TextMuted
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                LiquidGlassButton(
                                    onClick = {
                                        val uri = fileUri(file)
                                        if (uri == null) {
                                            Toast.makeText(context, "Файл больше недоступен", Toast.LENGTH_SHORT).show()
                                        } else {
                                            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                                                setDataAndType(uri, fileMimeType(file, uri))
                                                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                            }
                                            runCatching { context.startActivity(openIntent) }
                                                .onFailure { Toast.makeText(context, "Нет приложения для открытия этого файла", Toast.LENGTH_SHORT).show() }
                                        }
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(imageVector = Icons.Default.FolderOpen, contentDescription = "Открыть файл", tint = Color.White, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Открыть файл", fontSize = 11.sp)
                                }

                                LiquidGlassButton(
                                    onClick = {
                                        val uri = fileUri(file)
                                        if (uri == null) {
                                            Toast.makeText(context, "Файл больше недоступен", Toast.LENGTH_SHORT).show()
                                            return@LiquidGlassButton
                                        }
                                        val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                            type = fileMimeType(file, uri)
                                            putExtra(Intent.EXTRA_STREAM, uri)
                                            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                        }
                                        context.startActivity(Intent.createChooser(shareIntent, "Поделиться файлом"))
                                    },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(imageVector = Icons.Default.Share, contentDescription = "Поделиться файлом", tint = Color.White, modifier = Modifier.size(14.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Поделиться", fontSize = 11.sp)
                                }
                            }
                        }
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        Text(
            text = "Синхронизация буфера обмена",
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
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.Assignment,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "История буфера · ${clipboardHistory.size}/10",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        color = TextPrimary
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    LiquidGlassButton(
                        onClick = onReadPcClipboard,
                        modifier = Modifier.weight(1f)
                    ) {
                        Icon(imageVector = Icons.Default.ContentPaste, contentDescription = "Прочитать буфер компьютера", tint = Color.White, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Получить с ПК", fontSize = 12.sp)
                    }

                    LiquidGlassButton(
                        onClick = onClearClipboardHistory,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Очистить историю", fontSize = 12.sp)
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                if (clipboardHistory.isEmpty()) {
                    Column(
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(GlassWhiteLight).padding(14.dp)
                    ) {
                        Text(
                            text = if (clipboardData.text.isBlank()) "История пока пуста" else clipboardData.text,
                            fontSize = 13.sp,
                            color = TextMuted
                        )
                    }
                } else {
                    clipboardHistory.forEach { item ->
                        Column(
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(GlassWhiteLight).padding(14.dp)
                        ) {
                            Text(
                                text = item.text,
                                fontSize = 13.sp,
                                color = TextSecondary,
                                fontFamily = FontFamily.Monospace,
                                maxLines = 6
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(if (item.source == "pc") "С компьютера" else "С телефона", color = TextMuted, fontSize = 10.sp)
                            Spacer(Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                LiquidGlassButton(onClick = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    clipboard.setPrimaryClip(ClipData.newPlainText("Aether history", item.text))
                                    Toast.makeText(context, "Скопировано", Toast.LENGTH_SHORT).show()
                                }, modifier = Modifier.weight(1f)) { Text("Копировать", fontSize = 11.sp) }
                                LiquidGlassButton(onClick = { onSendToPcClipboard(item.text) }, modifier = Modifier.weight(1f)) { Text("На ПК", fontSize = 11.sp) }
                                LiquidGlassButton(onClick = { onDeleteClipboardItem(item.id) }) { Text("Удалить", fontSize = 11.sp) }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                OutlinedTextField(
                    value = sendClipboardText,
                    onValueChange = { sendClipboardText = it },
                    placeholder = { Text("Введите текст для отправки на ПК...") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary,
                        focusedBorderColor = GlassBorderTopLight,
                        unfocusedBorderColor = GlassWhiteMedium
                    )
                )

                Spacer(modifier = Modifier.height(12.dp))

                LiquidGlassButton(
                    onClick = {
                        if (sendClipboardText.isNotEmpty()) {
                            onSendToPcClipboard(sendClipboardText)
                            sendClipboardText = ""
                        }
                    },
                    isStrong = true,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(imageVector = Icons.Default.Send, contentDescription = "Отправить текст", tint = Color.White, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Отправить в буфер ПК", fontSize = 13.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(28.dp))

        LiquidGlassButton(
            onClick = onDisconnect,
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(
                imageVector = Icons.Default.LinkOff,
                contentDescription = "Отключиться от ПК",
                tint = Color.White,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text("Отключиться от ПК", fontSize = 13.sp, fontWeight = FontWeight.Medium)
        }

        Spacer(modifier = Modifier.height(120.dp))
    }
}
