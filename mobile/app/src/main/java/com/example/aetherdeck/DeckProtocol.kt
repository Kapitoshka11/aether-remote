package com.example.aetherdeck

import org.json.JSONObject
import java.util.UUID

object DeckProtocol {
    fun syncRequest() = JSONObject().put("action", "DECK_SYNC_REQUEST")
    fun assetRequest(hash: String) = JSONObject().put("action", "DECK_ASSET_REQUEST").put("hash", hash)
    fun trigger(revision: Long, deckId: String, pageId: String, controlId: String) = JSONObject()
        .put("action", "DECK_TRIGGER").put("triggerId", UUID.randomUUID().toString()).put("revision", revision)
        .put("deckId", deckId).put("pageId", pageId).put("controlId", controlId)
    fun slider(revision: Long, deckId: String, pageId: String, controlId: String, value: Double, sequence: Long) = JSONObject()
        .put("action", "DECK_SLIDER").put("triggerId", UUID.randomUUID().toString()).put("revision", revision)
        .put("deckId", deckId).put("pageId", pageId).put("controlId", controlId).put("value", value).put("sequence", sequence)
    fun navigate(deckId: String, pageId: String) = JSONObject().put("action", "DECK_NAVIGATE").put("deckId", deckId).put("pageId", pageId)
}
