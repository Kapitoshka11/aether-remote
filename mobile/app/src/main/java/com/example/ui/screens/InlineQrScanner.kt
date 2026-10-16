package com.example.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.example.ui.components.LiquidGlassButton
import com.example.ui.theme.GlassBorderTopLight
import com.example.ui.theme.GlassWhiteLight
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeCallback
import com.journeyapps.barcodescanner.BarcodeResult
import com.journeyapps.barcodescanner.DefaultDecoderFactory
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import java.util.concurrent.atomic.AtomicReference

@Composable
internal fun InlineQrScanner(
    onDecoded: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    var permissionRequested by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        permissionRequested = true
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(GlassWhiteLight)
            .border(1.dp, GlassBorderTopLight, RoundedCornerShape(18.dp))
            .padding(10.dp)
    ) {
        if (hasCameraPermission) {
            ScannerPreview(onDecoded = onDecoded)
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(220.dp)
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = if (permissionRequested) {
                        "Разрешите доступ к камере, чтобы отсканировать QR-код"
                    } else {
                        "Запрашиваем доступ к камере"
                    },
                    color = TextMuted,
                    fontSize = 13.sp
                )
                if (permissionRequested) {
                    LiquidGlassButton(
                        onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) },
                        modifier = Modifier.padding(top = 12.dp)
                    ) {
                        Text("Разрешить камеру", color = TextPrimary, fontSize = 13.sp)
                    }
                }
            }
        }

        IconButton(
            onClick = onClose,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .size(48.dp)
                .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(12.dp))
        ) {
            Icon(Icons.Default.Close, contentDescription = "Закрыть сканер", tint = Color.White)
        }
    }
}

@Composable
private fun ScannerPreview(onDecoded: (String) -> Unit) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentOnDecoded by rememberUpdatedState(onDecoded)
    val scanner = remember { AtomicReference<DecoratedBarcodeView?>(null) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(240.dp)
            .clip(RoundedCornerShape(12.dp))
    ) {
        AndroidView(
            factory = { context ->
                DecoratedBarcodeView(context).apply {
                    barcodeView.decoderFactory = DefaultDecoderFactory(listOf(BarcodeFormat.QR_CODE))
                    decodeContinuous(object : BarcodeCallback {
                        override fun barcodeResult(result: BarcodeResult?) {
                            val text = result?.text ?: return
                            post { currentOnDecoded(text) }
                        }
                    })
                    resume()
                    scanner.set(this)
                }
            },
            modifier = Modifier.fillMaxWidth()
        )

        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(176.dp)
                .border(2.dp, Color.White.copy(alpha = 0.9f), RoundedCornerShape(18.dp))
        )
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> scanner.get()?.resume()
                Lifecycle.Event.ON_PAUSE -> scanner.get()?.pause()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            scanner.getAndSet(null)?.let {
                it.barcodeView.stopDecoding()
                it.pause()
            }
        }
    }
}
