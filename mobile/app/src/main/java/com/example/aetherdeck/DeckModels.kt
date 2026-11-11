package com.example.aetherdeck

data class DeckAction(
    val id: String,
    val providerId: String,
    val type: String,
    val enabled: Boolean,
    val parameters: Map<String, Any?>
)

data class DeckControl(
    val id: String,
    val type: String,
    val label: String,
    val enabled: Boolean,
    val column: Int,
    val row: Int,
    val columnSpan: Int,
    val rowSpan: Int,
    val background: String,
    val foreground: String,
    val stateBinding: String?,
    val iconKind: String?,
    val iconName: String?,
    val iconHash: String?,
    val actions: List<DeckAction>,
    val minimum: Double = 0.0,
    val maximum: Double = 100.0,
    val step: Double = 1.0,
    val targetPageId: String? = null
)

data class DeckPage(
    val id: String,
    val name: String,
    val columns: Int,
    val background: String,
    val controls: List<DeckControl>,
    val backgroundAsset: String? = null
)
data class AetherDeck(val id: String, val name: String, val defaultPageId: String, val pages: List<DeckPage>)

data class DeckUiState(
    val configurationRevision: Long = 0,
    val stateRevision: Long = 0,
    val activeDeckId: String? = null,
    val activePageId: String? = null,
    val decks: List<AetherDeck> = emptyList(),
    val controlStates: Map<String, Map<String, Any?>> = emptyMap(),
    val variables: Map<String, Any?> = emptyMap(),
    val canNavigateBack: Boolean = false,
    val needsFullSync: Boolean = true,
    val unavailableReason: String? = null
) {
    val activeDeck: AetherDeck? get() = decks.firstOrNull { it.id == activeDeckId } ?: decks.firstOrNull()
    val activePage: DeckPage? get() = activeDeck?.pages?.firstOrNull { it.id == activePageId } ?: activeDeck?.pages?.firstOrNull()
}
