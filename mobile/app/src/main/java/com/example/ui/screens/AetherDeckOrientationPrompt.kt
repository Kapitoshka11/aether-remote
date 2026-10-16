package com.example.ui.screens

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ScreenRotation
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary

internal class AetherDeckOrientationVisitState {
    private var handled = false

    fun shouldShow(isPortrait: Boolean): Boolean = isPortrait && !handled

    fun markHandled() {
        handled = true
    }

    fun leave() {
        handled = false
    }
}

@Composable
internal fun AetherDeckOrientationPrompt(
    onLandscape: () -> Unit,
    onStay: () -> Unit
) {
    Dialog(onDismissRequest = {}) {
        LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.ScreenRotation,
                    contentDescription = null,
                    tint = TextPrimary,
                    modifier = Modifier.size(32.dp)
                )
                Spacer(modifier = Modifier.size(12.dp))
                Text(
                    text = "\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c \u044d\u043a\u0440\u0430\u043d?",
                    fontFamily = FontFamily.Serif,
                    fontStyle = FontStyle.Italic,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.size(12.dp))
                Text(
                    text = "\u0414\u043b\u044f Aether Deck \u0443\u0434\u043e\u0431\u043d\u0435\u0435 \u0432 \u0430\u043b\u044c\u0431\u043e\u043c\u043d\u043e\u0439 \u043e\u0440\u0438\u0435\u043d\u0442\u0430\u0446\u0438\u0438.",
                    fontSize = 14.sp,
                    color = TextMuted
                )
                Spacer(modifier = Modifier.size(24.dp))
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    LiquidGlassButton(
                        onClick = onStay,
                        modifier = Modifier.fillMaxWidth().testTag("deck-orientation-stay")
                    ) {
                        Text(
                            text = "\u041e\u0441\u0442\u0430\u0442\u044c\u0441\u044f",
                            fontSize = 13.sp,
                            color = TextPrimary
                        )
                    }
                    LiquidGlassButton(
                        onClick = onLandscape,
                        isStrong = true,
                        modifier = Modifier.fillMaxWidth().testTag("deck-orientation-landscape")
                    ) {
                        Icon(
                            imageVector = Icons.Default.ScreenRotation,
                            contentDescription = null,
                            tint = TextPrimary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u0432 \u0430\u043b\u044c\u0431\u043e\u043c\u043d\u044b\u0439 \u0440\u0435\u0436\u0438\u043c",
                            fontSize = 13.sp,
                            color = TextPrimary
                        )
                    }
                }
            }
        }
    }
}

internal tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
