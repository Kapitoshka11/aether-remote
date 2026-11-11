package com.example

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class AetherDeckUiTest {
    @Test
    fun dashboardExposesAdaptiveAetherDeckCategoryAndEveryControlType() {
        val root = File(System.getProperty("user.dir"))
        val dashboard = File(root, "src/main/java/com/example/ui/main/MainDashboardScreen.kt").readText()
        val screen = File(root, "src/main/java/com/example/ui/screens/AetherDeckTab.kt")
        assertTrue(dashboard.contains("NavigationTab.AETHER_DECK"))
        assertTrue(dashboard.contains("Aether Deck"))
        assertTrue(screen.exists())
        val source = screen.readText()
        listOf("button", "toggle", "slider", "folder", "status").forEach { assertTrue(source.contains("\"$it\"")) }
        assertTrue(source.contains("page.columns"))
        assertTrue(source.contains("columnSpan"))
        assertTrue(source.contains("canNavigateBack"))
        assertTrue(source.contains("Назад"))
        assertTrue(source.contains("onNavigateBack"))
        assertTrue(source.contains("LiquidGlassStrongCard"))
        assertTrue(source.contains("FontStyle.Italic"))
        assertTrue(source.contains("Создайте Deck в приложении на ПК"))
        assertTrue(source.contains("Icons.Default.Refresh"))
        val controls = File(root, "src/main/java/com/example/ui/components/AetherDeckControls.kt").readText()
        assertTrue(controls.contains("AsyncImage"))
        assertTrue(controls.contains("SvgDecoder.Factory"))
        assertTrue(!controls.contains("WebView"))
        assertTrue(controls.contains("iconName"))
        assertTrue(controls.contains("state[\"running\"]"))
        assertTrue(controls.contains("Нет данных"))
        assertTrue(controls.contains("control.type == \"status\""))
        assertTrue(controls.contains("SliderDefaults.colors"))
        assertTrue(controls.contains("Icons.AutoMirrored.Filled.ArrowForward"))
        assertTrue(controls.contains("Включено"))
        assertTrue(controls.contains("Выключено"))
        assertTrue(controls.contains("Страница не выбрана"))
        assertTrue(controls.contains("LiquidGlassCard"))
        assertTrue(controls.contains("control.type == \"status\" -> Text(statusValue(control, dynamicValue)"))
    }
}
