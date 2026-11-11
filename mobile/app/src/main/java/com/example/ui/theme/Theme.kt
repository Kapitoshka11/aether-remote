package com.example.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

enum class AetherThemeMode { DARK, LIGHT }

private val DarkColorScheme = darkColorScheme(
    primary = AetherViolet, onPrimary = Color.White,
    primaryContainer = Color(0xFF4B2114), onPrimaryContainer = Color(0xFFFFE5D2),
    secondary = AetherAmber, onSecondary = Color(0xFF2A140C),
    background = DarkAetherColors.background, onBackground = DarkAetherColors.textPrimary,
    surface = DarkAetherColors.surface, onSurface = DarkAetherColors.textPrimary,
    surfaceVariant = Color(0xFF241813), onSurfaceVariant = DarkAetherColors.textSecondary,
    outline = DarkAetherColors.borderBottomLight
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFFE14923), onPrimary = Color.White,
    primaryContainer = Color(0xFFFFDDC8), onPrimaryContainer = Color(0xFF461508),
    secondary = Color(0xFFFF7A2D), onSecondary = Color.White,
    background = LightAetherColors.background, onBackground = LightAetherColors.textPrimary,
    surface = Color.White, onSurface = LightAetherColors.textPrimary,
    surfaceVariant = LightAetherColors.surface, onSurfaceVariant = LightAetherColors.textSecondary,
    outline = LightAetherColors.borderBottomLight
)

@Composable
fun AetherTheme(themeMode: AetherThemeMode, content: @Composable () -> Unit) {
    val isDark = themeMode == AetherThemeMode.DARK
    val colors = if (isDark) DarkAetherColors else LightAetherColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = Color.Transparent.toArgb()
            window.navigationBarColor = colors.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !isDark
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !isDark
        }
    }

    CompositionLocalProvider(LocalAetherColors provides colors) {
        MaterialTheme(
            colorScheme = if (isDark) DarkColorScheme else LightColorScheme,
            typography = Typography,
            content = content
        )
    }
}
