package com.example.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val HeadingSerifItalic = TextStyle(
    fontFamily = FontFamily.Serif,
    fontStyle = FontStyle.Italic,
    fontWeight = FontWeight.Normal,
    color = Color.Unspecified
)

val BodySans = TextStyle(
    fontFamily = FontFamily.SansSerif,
    fontStyle = FontStyle.Normal,
    fontWeight = FontWeight.Normal,
    color = Color.Unspecified
)

val Typography = Typography(
    displayLarge = HeadingSerifItalic.copy(fontSize = 44.sp, lineHeight = 48.sp),
    displayMedium = HeadingSerifItalic.copy(fontSize = 36.sp, lineHeight = 40.sp),
    displaySmall = HeadingSerifItalic.copy(fontSize = 28.sp, lineHeight = 32.sp),

    headlineLarge = HeadingSerifItalic.copy(fontSize = 24.sp, lineHeight = 28.sp),
    headlineMedium = HeadingSerifItalic.copy(fontSize = 20.sp, lineHeight = 24.sp),
    headlineSmall = HeadingSerifItalic.copy(fontSize = 18.sp, lineHeight = 22.sp),

    titleLarge = BodySans.copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = BodySans.copy(fontSize = 16.sp, fontWeight = FontWeight.Medium),
    titleSmall = BodySans.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),

    bodyLarge = BodySans.copy(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = BodySans.copy(fontSize = 14.sp, lineHeight = 18.sp),
    bodySmall = BodySans.copy(fontSize = 12.sp, lineHeight = 16.sp, color = Color.Unspecified),

    labelLarge = BodySans.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelMedium = BodySans.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium, color = Color.Unspecified),
    labelSmall = BodySans.copy(fontSize = 10.sp, fontWeight = FontWeight.Normal, color = Color.Unspecified)
)
