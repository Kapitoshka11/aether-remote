package com.example.aetherdeck

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.round

class DeckStore(private val send: (String) -> Unit) {
    private companion object {
        val HASH_PATTERN = Regex("^[a-f0-9]{64}$")
        const val MAX_NAVIGATION_HISTORY = 50
        const val MAX_DECKS = 32
        const val MAX_PAGES_PER_DECK = 64
        const val MAX_CONTROLS_PER_PAGE = 128
        const val MAX_ACTIONS_PER_CONTROL = 16
        const val MAX_GRID_ROW = 63
        const val MAX_ROW_SPAN = 16
        const val MAX_OBJECT_ENTRIES = 256
        const val MAX_JSON_DEPTH = 8
        const val MAX_ASSETS_PER_PAGE = 16
        const val MAX_STATE_KEY_CHARS = 256
        const val MAX_STATE_STRING_CHARS = 4096
        const val MAX_RETAINED_STATE_BYTES = 1024 * 1024L
    }
    private val _state = MutableStateFlow(DeckUiState())
    val state: StateFlow<DeckUiState> = _state.asStateFlow()
    private val sliderSequences = mutableMapOf<String, Long>()
    private val navigationHistory = mutableListOf<Pair<String, String>>()
    private var pendingNavigation: Pair<String, String>? = null

    @Synchronized fun reset() { _state.value = DeckUiState(); sliderSequences.clear(); navigationHistory.clear(); pendingNavigation = null }
    fun requestDeckSync() = send(DeckProtocol.syncRequest().toString())
    @Synchronized fun markUnavailable(reason: String) {
        navigationHistory.clear()
        pendingNavigation = null
        _state.value = DeckUiState(needsFullSync = false, unavailableReason = reason)
    }
    fun requestAsset(hash: String) = send(DeckProtocol.assetRequest(hash).toString())
    fun triggerControl(deckId: String, pageId: String, controlId: String) = send(DeckProtocol.trigger(_state.value.configurationRevision, deckId, pageId, controlId).toString())
    @Synchronized fun setSliderValue(deckId: String, pageId: String, controlId: String, value: Double): Boolean {
        val control = _state.value.decks.firstOrNull { it.id == deckId }
            ?.pages?.firstOrNull { it.id == pageId }
            ?.controls?.firstOrNull { it.id == controlId && it.type == "slider" }
            ?: return false
        if (!value.isFinite() || !control.minimum.isFinite() || !control.maximum.isFinite() || control.maximum <= control.minimum) return false
        val step = control.step.takeIf { it.isFinite() && it > 0.0 } ?: 1.0
        val clamped = value.coerceIn(control.minimum, control.maximum)
        val snapped = (control.minimum + round((clamped - control.minimum) / step) * step)
            .coerceIn(control.minimum, control.maximum)
        val sequence = (sliderSequences[controlId] ?: 0L) + 1L
        sliderSequences[controlId] = sequence
        send(DeckProtocol.slider(_state.value.configurationRevision, deckId, pageId, controlId, snapped, sequence).toString())
        return true
    }
    @Synchronized fun canNavigateBack(): Boolean = navigationHistory.isNotEmpty()
    fun navigate(deckId: String, pageId: String) = navigateTo(deckId, pageId)
    @Synchronized fun navigateTo(deckId: String, pageId: String): Boolean {
        val currentDeckId = _state.value.activeDeckId ?: return false
        val currentPageId = _state.value.activePageId ?: return false
        val targetExists = _state.value.decks.any { deck -> deck.id == deckId && deck.pages.any { it.id == pageId } }
        if (!targetExists || currentDeckId == deckId && currentPageId == pageId) return false
        navigationHistory += currentDeckId to currentPageId
        if (navigationHistory.size > MAX_NAVIGATION_HISTORY) navigationHistory.removeAt(0)
        pendingNavigation = deckId to pageId
        _state.value = _state.value.copy(activeDeckId = deckId, activePageId = pageId, canNavigateBack = true)
        send(DeckProtocol.navigate(deckId, pageId).toString())
        return true
    }
    @Synchronized fun navigateBack(): Boolean {
        val target = navigationHistory.removeLastOrNull() ?: return false
        pendingNavigation = target
        _state.value = _state.value.copy(activeDeckId = target.first, activePageId = target.second, canNavigateBack = navigationHistory.isNotEmpty())
        send(DeckProtocol.navigate(target.first, target.second).toString())
        return true
    }

    @Synchronized fun handle(message: JSONObject): Boolean = when (message.optString("action")) {
        "DECK_SNAPSHOT" -> { applySnapshot(message); true }
        "DECK_PATCH" -> { applyPatch(message); true }
        "DECK_STATE_PATCH" -> { applyStatePatch(message); true }
        "DECK_NAVIGATION" -> {
            val deckId = message.optString("deckId").ifBlank { _state.value.activeDeckId.orEmpty() }.ifBlank { null }
            val pageId = message.optString("pageId").ifBlank { _state.value.activePageId.orEmpty() }.ifBlank { null }
            val target = if (deckId != null && pageId != null) deckId to pageId else null
            val targetExists = target != null && _state.value.decks.any { deck ->
                deck.id == target.first && deck.pages.any { it.id == target.second }
            }
            if (!targetExists) {
                pendingNavigation = null
                _state.value = _state.value.copy(needsFullSync = true)
                requestDeckSync()
            } else {
                if (pendingNavigation != target) navigationHistory.clear()
                pendingNavigation = null
                _state.value = _state.value.copy(activeDeckId = deckId, activePageId = pageId, canNavigateBack = navigationHistory.isNotEmpty())
            }
            true
        }
        "DECK_ACTION_RESULT" -> {
            val status = message.optString("status")
            val needsSync = status == "STALE_REVISION" || status == "CONTROL_NOT_FOUND"
            if (needsSync) _state.value = _state.value.copy(needsFullSync = true)
            if (needsSync) requestDeckSync()
            true
        }
        "DECK_UNAVAILABLE" -> {
            markUnavailable(message.optString("error", "Aether Deck недоступен на этом хосте"))
            true
        }
        else -> false
    }

    @Synchronized fun applySnapshot(message: JSONObject) {
        applySnapshotInternal(message, _state.value.decks.isEmpty())
    }

    private fun applySnapshotInternal(message: JSONObject, resetNavigation: Boolean): Boolean {
        val document = message.optJSONObject("document") ?: return false
        val revision = message.optLong("revision", document.optLong("revision", -1))
        if (_state.value.decks.isNotEmpty() && revision < _state.value.configurationRevision) return false
        val decks = parseDecks(document.optJSONArray("decks") ?: JSONArray())
        if (decks.isEmpty()) {
            _state.value = _state.value.copy(needsFullSync = true)
            return false
        }
        if (resetNavigation) { navigationHistory.clear(); pendingNavigation = null }
        navigationHistory.removeAll { (deckId, pageId) -> !targetExists(decks, deckId, pageId) }
        pendingNavigation = pendingNavigation?.takeIf { targetExists(decks, it.first, it.second) }
        val requestedDeckId = message.optString("activeDeckId", document.optString("activeDeckId"))
        val activeDeck = decks.firstOrNull { it.id == requestedDeckId } ?: decks.first()
        val requestedPageId = message.optString("activePageId", document.optString("activePageId"))
        val activePageId = requestedPageId.takeIf { id -> activeDeck.pages.any { it.id == id } }
            ?: activeDeck.defaultPageId.takeIf { id -> activeDeck.pages.any { it.id == id } }
            ?: activeDeck.pages.first().id
        val parsedControlStates = stateMap(document.optJSONObject("controlStates"), controlIds(decks))
        val parsedVariables = flattenedObjectMap(document.optJSONObject("variables"))
        if (retainedStateBytes(parsedControlStates, parsedVariables) > MAX_RETAINED_STATE_BYTES) {
            _state.value = _state.value.copy(needsFullSync = true)
            requestDeckSync()
            return false
        }
        _state.value = DeckUiState(
            configurationRevision = revision.coerceAtLeast(0),
            stateRevision = message.optLong("stateRevision", document.optLong("stateRevision")),
            activeDeckId = activeDeck.id,
            activePageId = activePageId,
            decks = decks,
            controlStates = parsedControlStates,
            variables = parsedVariables,
            canNavigateBack = navigationHistory.isNotEmpty(),
            needsFullSync = false
        )
        return true
    }

    @Synchronized fun applyPatch(message: JSONObject): Boolean {
        val fromRevision = message.optLong("fromRevision", -1)
        val toRevision = message.optLong("toRevision", -1)
        if (fromRevision != _state.value.configurationRevision || toRevision <= fromRevision) {
            _state.value = _state.value.copy(needsFullSync = true)
            return false
        }
        val document = message.optJSONObject("document") ?: return false
        if (document.has("revision") && document.optLong("revision", -1) != toRevision) {
            _state.value = _state.value.copy(needsFullSync = true)
            return false
        }
        val previous = _state.value
        if (!applySnapshotInternal(JSONObject().put("document", document).put("revision", toRevision).put("stateRevision", previous.stateRevision).put("activeDeckId", previous.activeDeckId).put("activePageId", previous.activePageId), false)) return false
        val validControlIds = controlIds(_state.value.decks)
        _state.value = _state.value.copy(
            stateRevision = previous.stateRevision,
            controlStates = previous.controlStates.entries.asSequence()
                .filter { it.key in validControlIds }
                .take(MAX_OBJECT_ENTRIES)
                .associate { it.toPair() },
            variables = previous.variables.entries.asSequence()
                .take(MAX_OBJECT_ENTRIES)
                .associate { it.toPair() }
        )
        return true
    }

    private fun applyStatePatch(message: JSONObject) {
        val revision = message.optLong("stateRevision", _state.value.stateRevision)
        if (revision <= _state.value.stateRevision) return
        val sourceStates = message.optJSONObject("states")
        val sourceVariables = message.optJSONObject("variables")
        if ((sourceStates?.length() ?: 0) > MAX_OBJECT_ENTRIES ||
            (sourceVariables?.length() ?: 0) > MAX_OBJECT_ENTRIES
        ) {
            rejectStatePatch()
            return
        }
        val validControlIds = controlIds(_state.value.decks)
        val states = _state.value.controlStates.toMutableMap()
        sourceStates?.let { source -> source.keys().asSequence().filter { it in validControlIds }.forEach { id -> states[id] = objectMap(source.optJSONObject(id)) } }
        val variables = _state.value.variables.toMutableMap()
        sourceVariables?.let { source -> source.keys().asSequence().filter { it.length <= MAX_STATE_KEY_CHARS }.forEach { key -> variables[key] = jsonValue(source.opt(key), 0) } }
        if (states.size > MAX_OBJECT_ENTRIES || variables.size > MAX_OBJECT_ENTRIES ||
            retainedStateBytes(states, variables) > MAX_RETAINED_STATE_BYTES
        ) {
            rejectStatePatch()
            return
        }
        _state.value = _state.value.copy(stateRevision = revision, controlStates = states, variables = variables)
    }

    private fun rejectStatePatch() {
        _state.value = _state.value.copy(needsFullSync = true)
        requestDeckSync()
    }

    private fun controlIds(decks: List<AetherDeck>): Set<String> = decks.asSequence()
        .flatMap { it.pages.asSequence() }
        .flatMap { it.controls.asSequence() }
        .map { it.id }
        .toSet()

    private fun targetExists(decks: List<AetherDeck>, deckId: String, pageId: String): Boolean =
        decks.any { deck -> deck.id == deckId && deck.pages.any { it.id == pageId } }

    private fun parseDecks(array: JSONArray): List<AetherDeck> {
        val deckIds = mutableSetOf<String>()
        val controlIds = mutableSetOf<String>()
        return (0 until minOf(array.length(), MAX_DECKS)).mapNotNull { index ->
            val deck = array.optJSONObject(index) ?: return@mapNotNull null
            val deckId = deck.optString("id").takeIf { it.isNotBlank() && deckIds.add(it) } ?: return@mapNotNull null
            val pages = parsePages(deck.optJSONArray("pages") ?: JSONArray(), controlIds)
            if (pages.isEmpty()) return@mapNotNull null
            val defaultPageId = deck.optString("defaultPageId").takeIf { id -> pages.any { it.id == id } } ?: pages.first().id
            AetherDeck(deckId, deck.optString("name").take(200), defaultPageId, pages)
        }
    }
    private fun parsePages(array: JSONArray, controlIds: MutableSet<String>): List<DeckPage> {
        val pageIds = mutableSetOf<String>()
        return (0 until minOf(array.length(), MAX_PAGES_PER_DECK)).mapNotNull { index ->
        val page = array.optJSONObject(index) ?: return@mapNotNull null
        val pageId = page.optString("id").takeIf { it.isNotBlank() && pageIds.add(it) } ?: return@mapNotNull null
        val columns = page.optInt("columns", 4).coerceIn(3, 8)
        val backgroundAsset = page.optString("backgroundAsset").takeIf { HASH_PATTERN.matches(it) }
        DeckPage(pageId, page.optString("name").take(200), columns, page.optString("background", "#08090b").take(64), parseControls(page.optJSONArray("controls") ?: JSONArray(), columns, controlIds, MAX_ASSETS_PER_PAGE - if (backgroundAsset == null) 0 else 1), backgroundAsset)
        }
    }
    private fun parseControls(array: JSONArray, columns: Int, controlIds: MutableSet<String>, assetBudget: Int): List<DeckControl> {
        val acceptedAssets = mutableSetOf<String>()
        return (0 until minOf(array.length(), MAX_CONTROLS_PER_PAGE)).mapNotNull { index ->
        val item = array.optJSONObject(index) ?: return@mapNotNull null
        val id = item.optString("id").takeIf { it.isNotBlank() && controlIds.add(it) } ?: return@mapNotNull null
        val type = item.optString("type", "button").takeIf { it in setOf("button", "toggle", "slider", "folder", "status") } ?: return@mapNotNull null
        val icon = item.optJSONObject("icon")
        val column = item.optInt("column").coerceIn(0, columns - 1)
        val columnSpan = item.optInt("columnSpan", 1).coerceIn(1, columns - column)
        val rawMinimum = item.optDouble("minimum", 0.0)
        val rawMaximum = item.optDouble("maximum", 100.0)
        val validRange = rawMinimum.isFinite() && rawMaximum.isFinite() && rawMaximum > rawMinimum
        val minimum = if (validRange) rawMinimum else 0.0
        val maximum = if (validRange) rawMaximum else 100.0
        val step = item.optDouble("step", 1.0).takeIf { it.isFinite() && it > 0.0 && it <= maximum - minimum } ?: 1.0
        val requestedIconHash = icon?.optString("hash")?.takeIf(HASH_PATTERN::matches)
        val iconHash = requestedIconHash?.takeIf { it in acceptedAssets || acceptedAssets.size < assetBudget }
        if (iconHash != null) acceptedAssets += iconHash
        DeckControl(id, type, item.optString("label").take(160), item.optBoolean("enabled", true), column, item.optInt("row").coerceIn(0, MAX_GRID_ROW), columnSpan, item.optInt("rowSpan", 1).coerceIn(1, MAX_ROW_SPAN), item.optString("background", "#17151f").take(64), item.optString("foreground", "#ffffff").take(64), item.optString("stateBinding").take(160).ifBlank { null }, icon?.optString("kind"), icon?.optString("name"), iconHash, parseActions(item.optJSONArray("actions") ?: JSONArray()), minimum, maximum, step, item.optString("targetPageId").ifBlank { null })
        }
    }
    private fun parseActions(array: JSONArray): List<DeckAction> = (0 until minOf(array.length(), MAX_ACTIONS_PER_CONTROL)).mapNotNull { index -> array.optJSONObject(index) }.map { item -> DeckAction(item.optString("id"), item.optString("providerId"), item.optString("type"), item.optBoolean("enabled", true), objectMap(item.optJSONObject("parameters"))) }
    private fun stateMap(source: JSONObject?, validControlIds: Set<String>): Map<String, Map<String, Any?>> = source?.keys()?.asSequence()?.filter { it in validControlIds }?.take(MAX_OBJECT_ENTRIES)?.associateWith { key -> objectMap(source.optJSONObject(key)) } ?: emptyMap()
    private fun objectMap(source: JSONObject?, depth: Int = 0): Map<String, Any?> = if (source == null || depth >= MAX_JSON_DEPTH) emptyMap() else source.keys().asSequence().take(MAX_OBJECT_ENTRIES).associateWith { key -> jsonValue(source.opt(key), depth + 1) }
    private fun flattenedObjectMap(source: JSONObject?): Map<String, Any?> {
        if (source == null) return emptyMap()
        val result = linkedMapOf<String, Any?>()
        fun visit(value: JSONObject, prefix: String, depth: Int) {
            if (depth >= MAX_JSON_DEPTH || result.size >= MAX_OBJECT_ENTRIES) return
            value.keys().asSequence().take(MAX_OBJECT_ENTRIES - result.size).forEach { key ->
                val path = (if (prefix.isEmpty()) key else "$prefix.$key").take(MAX_STATE_KEY_CHARS)
                val child = value.opt(key)
                if (child is JSONObject) visit(child, path, depth + 1) else result[path] = jsonValue(child, depth + 1)
            }
        }
        visit(source, "", 0)
        return result
    }
    private fun jsonValue(value: Any?, depth: Int): Any? = when {
        depth >= MAX_JSON_DEPTH -> null
        else -> when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> objectMap(value, depth + 1)
        is JSONArray -> (0 until minOf(value.length(), MAX_OBJECT_ENTRIES)).map { index -> jsonValue(value.opt(index), depth + 1) }
        is String -> value.take(MAX_STATE_STRING_CHARS)
        else -> value
        }
    }

    private fun retainedStateBytes(states: Map<String, Map<String, Any?>>, variables: Map<String, Any?>): Long =
        states.entries.sumOf { (key, value) -> key.length * 2L + estimatedValueBytes(value) } +
            variables.entries.sumOf { (key, value) -> key.length * 2L + estimatedValueBytes(value) }

    private fun estimatedValueBytes(value: Any?): Long = when (value) {
        null -> 4
        is String -> value.length * 2L
        is Number, is Boolean -> 16
        is Map<*, *> -> value.entries.sumOf { (key, child) -> key.toString().length * 2L + estimatedValueBytes(child) }
        is List<*> -> value.sumOf(::estimatedValueBytes)
        else -> value.toString().length * 2L
    }
}
