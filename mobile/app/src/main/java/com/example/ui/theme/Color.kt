package com.example.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

data class AetherColors(
    val background: Color,
    val surface: Color,
    val glassUltraThin: Color,
    val glassLight: Color,
    val glassMedium: Color,
    val glassStrong: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val textSubtle: Color,
    val borderTopLight: Color,
    val borderBottomLight: Color,
    val borderTopStrong: Color,
    val borderBottomStrong: Color
)

internal val DarkAetherColors = AetherColors(
    background = Color(0xFF080706), surface = Color(0xFF12100E),
    glassUltraThin = Color(0x09FFF2E8), glassLight = Color(0x12FFF2E8),
    glassMedium = Color(0x22FFE6D5), glassStrong = Color(0x34FFD7BE),
    textPrimary = Color.White, textSecondary = Color(0xD9FFFFFF),
    textMuted = Color(0x8FFFFFFF), textSubtle = Color(0x52FFFFFF),
    borderTopLight = Color(0x66FFB27E), borderBottomLight = Color(0x24FFD7BE),
    borderTopStrong = Color(0x88FFC49D), borderBottomStrong = Color(0x42FF9A52)
)

internal val LightAetherColors = AetherColors(
    background = Color(0xFFFFF8F2), surface = Color(0xFFFFEDE0),
    glassUltraThin = Color(0x52FFFFFF), glassLight = Color(0xA8FFFFFF),
    glassMedium = Color(0xD6FFFFFF), glassStrong = Color(0xF2FFFFFF),
    textPrimary = Color(0xFF2B1710), textSecondary = Color(0xD93A2118),
    textMuted = Color(0x995A4035), textSubtle = Color(0x665A4035),
    borderTopLight = Color(0x66E14923), borderBottomLight = Color(0x33FF9A52),
    borderTopStrong = Color(0x99E14923), borderBottomStrong = Color(0x55FF9A52)
)

internal val LocalAetherColors = staticCompositionLocalOf<AetherColors> {
    error("Aether colors must be provided by AetherTheme")
}

val PitchBlack: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.background
val ObsidianSurface: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.surface
val GlassWhiteUltraThin: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.glassUltraThin
val GlassWhiteLight: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.glassLight
val GlassWhiteMedium: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.glassMedium
val GlassWhiteStrong: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.glassStrong
val TextPrimary: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.textPrimary
val TextSecondary: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.textSecondary
val TextMuted: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.textMuted
val TextSubtle: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.textSubtle
val GlassBorderTopLight: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.borderTopLight
val GlassBorderBottomLight: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.borderBottomLight
val GlassBorderTopStrong: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.borderTopStrong
val GlassBorderBottomStrong: Color @Composable @ReadOnlyComposable get() = LocalAetherColors.current.borderBottomStrong

val AetherViolet = Color(0xFFF9733D)
val AetherAmber = Color(0xFFFF9A52)
val StatusOnline = Color(0xFF22C55E)
val StatusOffline = Color(0xFFEF4444)
val StatusConnecting = Color(0xFFEAB308)
