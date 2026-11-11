package com.example.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Widgets
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import com.example.aetherdeck.DeckControl
import com.example.aetherdeck.DeckUiState
import com.example.ui.components.AetherDeckControl
import com.example.ui.components.AetherDeckAssetImage
import com.example.ui.components.LiquidGlassButton
import com.example.ui.components.LiquidGlassStrongCard
import com.example.ui.theme.AetherViolet
import com.example.ui.theme.TextMuted
import com.example.ui.theme.TextPrimary

internal data class DeckGridPlacement(val column: Int, val columnSpan: Int)

internal fun safeDeckGridPlacement(column: Int, columnSpan: Int, columns: Int): DeckGridPlacement {
    val safeColumns = columns.coerceAtLeast(1)
    val safeColumn = column.coerceIn(0, safeColumns - 1)
    return DeckGridPlacement(safeColumn, columnSpan.coerceIn(1, safeColumns - safeColumn))
}

private fun resolveVariable(variables: Map<String, Any?>, path: String?): Any? {
    if (path.isNullOrBlank()) return null
    variables[path]?.let { return it }
    var current: Any? = variables
    path.split('.').forEach { part -> current = (current as? Map<*, *>)?.get(part) }
    return current
}

@Composable
fun AetherDeckTab(
    state: DeckUiState,
    onSync: () -> Unit,
    onTrigger: (DeckControl) -> Unit,
    onSlider: (DeckControl, Double) -> Unit,
    onNavigate: (String, String) -> Unit,
    onNavigateBack: () -> Unit,
    assetRevision: Long,
    loadAsset: (String) -> Pair<String, ByteArray>?,
    requestAsset: (String) -> Unit
) {
    val deck = state.activeDeck
    val page = state.activePage
    LaunchedEffect(state.needsFullSync, state.unavailableReason) {
        if (state.needsFullSync && state.unavailableReason == null) onSync()
    }
    Column(Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Aether Deck",
                    color = TextPrimary,
                    fontFamily = FontFamily.Serif,
                    fontStyle = FontStyle.Italic,
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp
                )
                Text(
                    text = listOfNotNull(deck?.name, page?.name).joinToString("  /  "),
                    color = TextMuted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.width(12.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                if (state.canNavigateBack) {
                    LiquidGlassButton(onClick = onNavigateBack, modifier = Modifier.height(46.dp)) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = TextPrimary)
                        androidx.compose.foundation.layout.Spacer(Modifier.width(6.dp))
                        Text("Назад", color = TextPrimary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                }
                if (state.unavailableReason == null) {
                    LiquidGlassButton(onClick = onSync, modifier = Modifier.height(46.dp)) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = TextPrimary)
                    }
                }
            }
        }
        if (deck == null || page == null) {
            Box(
                modifier = Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = 118.dp),
                contentAlignment = Alignment.Center
            ) {
                LiquidGlassStrongCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(28.dp)
                ) {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(28.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Widgets,
                            contentDescription = null,
                            tint = AetherViolet,
                            modifier = Modifier.height(32.dp).width(32.dp)
                        )
                        Text(
                            if (state.unavailableReason == null) "Создайте Deck в приложении на ПК" else "Aether Deck недоступен",
                            color = TextPrimary,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            state.unavailableReason ?: "Конфигурация появится здесь автоматически после синхронизации с ПК.",
                            color = TextMuted,
                            fontSize = 12.sp
                        )
                        if (state.unavailableReason == null) {
                            LiquidGlassButton(onClick = onSync, isStrong = true) {
                                Icon(Icons.Default.Refresh, contentDescription = null, tint = TextPrimary)
                                androidx.compose.foundation.layout.Spacer(Modifier.width(8.dp))
                                Text("Синхронизировать", color = TextPrimary, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
            return
        }
        BoxWithConstraints(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 118.dp)) {
            val gap = 8.dp
            val cellWidth = (maxWidth - gap * (page.columns - 1)) / page.columns
            val rowHeight = 88.dp
            val totalRows = (page.controls.maxOfOrNull { it.row + it.rowSpan } ?: 1).coerceAtLeast(5)
            LiquidGlassStrongCard(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(28.dp)) {
                Box(Modifier.fillMaxWidth().height(rowHeight * totalRows + gap * (totalRows - 1))) {
                    val backgroundAsset = page.backgroundAsset?.let { hash -> assetRevision; loadAsset(hash) }
                    AetherDeckAssetImage(
                        hash = page.backgroundAsset,
                        asset = backgroundAsset,
                        onMissingAsset = requestAsset,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                    page.controls.forEach { control ->
                        val placement = safeDeckGridPlacement(control.column, control.columnSpan, page.columns)
                        val row = control.row.coerceAtLeast(0)
                        val rowSpan = control.rowSpan.coerceAtLeast(1)
                        Box(Modifier.offset(x = (cellWidth + gap) * placement.column, y = (rowHeight + gap) * row).width(cellWidth * placement.columnSpan + gap * (placement.columnSpan - 1)).height(rowHeight * rowSpan + gap * (rowSpan - 1))) {
                            val asset = control.iconHash?.let { hash -> assetRevision; loadAsset(hash) }
                            val renderControl = if (control.type == "folder" && control.targetPageId?.let { target -> deck.pages.none { it.id == target } } == true) control.copy(targetPageId = null) else control
                            when (renderControl.type) { "button", "toggle", "slider", "folder", "status" -> AetherDeckControl(renderControl, state.controlStates[control.id].orEmpty(), resolveVariable(state.variables, control.stateBinding), asset, requestAsset, { onTrigger(control) }, { onSlider(control, it) }, { renderControl.targetPageId?.let { pageId -> onNavigate(deck.id, pageId) } }) }
                        }
                    }
                }
            }
        }
    }
}
