package com.example

import com.example.aetherdeck.DeckProtocol
import com.example.aetherdeck.DeckAssetCache
import com.example.aetherdeck.DeckStore
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.security.MessageDigest

@RunWith(RobolectricTestRunner::class)
class AetherDeckStoreTest {
    private fun navigationSnapshot() = JSONObject("""{
        "action":"DECK_SNAPSHOT","revision":1,"activeDeckId":"deck","activePageId":"root",
        "document":{"revision":1,"activeDeckId":"deck","activePageId":"root","decks":[{"id":"deck","name":"Deck","defaultPageId":"root","pages":[{"id":"root","name":"Главная","columns":4,"controls":[]},{"id":"child","name":"Медиа","columns":4,"controls":[]}]}]}}
      """)

    @Test
    fun folderNavigationBuildsAStableBackStackAndBackgroundSnapshotPreservesIt() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        val snapshot = JSONObject("""{
          "action":"DECK_SNAPSHOT","revision":1,"activeDeckId":"deck","activePageId":"root",
          "document":{"revision":1,"activeDeckId":"deck","activePageId":"root","decks":[{"id":"deck","name":"Deck","defaultPageId":"root","pages":[{"id":"root","name":"Главная","columns":4,"controls":[]},{"id":"child","name":"Медиа","columns":4,"controls":[]}]}]}
        }""")
        store.handle(snapshot)
        assertFalse(store.canNavigateBack())
        assertTrue(store.navigateTo("deck", "child"))
        assertTrue(store.canNavigateBack())
        assertEquals("child", store.state.value.activePageId)
        assertEquals("child", JSONObject(sent.last()).getString("pageId"))
        assertFalse(store.navigateTo("deck", "child"))
        assertTrue(store.navigateBack())
        assertEquals("root", store.state.value.activePageId)
        assertEquals("root", JSONObject(sent.last()).getString("pageId"))
        assertFalse(store.canNavigateBack())
        assertFalse(store.navigateBack())
        store.navigateTo("deck", "child")
        store.handle(snapshot)
        assertTrue(store.canNavigateBack())
        store.reset()
        assertFalse(store.canNavigateBack())
    }

    @Test
    fun navigationHistoryIsBoundedAndUnavailableHostStopsSync() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        store.handle(navigationSnapshot())
        repeat(60) { index -> store.navigateTo("deck", if (index % 2 == 0) "child" else "root") }
        repeat(50) { assertTrue(store.navigateBack()) }
        assertFalse(store.navigateBack())

        assertTrue(store.handle(JSONObject("""{"action":"DECK_UNAVAILABLE","error":"Full host required"}""")))
        assertEquals("Full host required", store.state.value.unavailableReason)
        assertFalse(store.state.value.needsFullSync)
    }

    @Test
    fun navigationRemainsSafeWhenSocketAndUiThreadsUpdateItTogether() {
        val sent = ConcurrentLinkedQueue<String>()
        val store = DeckStore { sent += it }
        store.handle(navigationSnapshot())
        val executor = Executors.newFixedThreadPool(2)
        repeat(250) { index ->
            executor.execute { store.navigateTo("deck", if (index % 2 == 0) "child" else "root") }
            executor.execute {
                store.handle(JSONObject().put("action", "DECK_NAVIGATION").put("deckId", "deck").put("pageId", if (index % 2 == 0) "child" else "root"))
            }
        }
        executor.shutdown()
        assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
        assertTrue(store.state.value.activePageId in setOf("root", "child"))
        assertTrue(sent.all { JSONObject(it).optString("action") == "DECK_NAVIGATE" })
    }

    @Test
    fun assetChunksAreReassembledIntoHashCache() {
        val cache = DeckAssetCache(org.robolectric.RuntimeEnvironment.getApplication())
        cache.clear()
        val bytes = byteArrayOf(
            0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            0x00, 0x00, 0x00, 0x00
        )
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val first = android.util.Base64.encodeToString(bytes.copyOfRange(0, 6), android.util.Base64.NO_WRAP)
        val second = android.util.Base64.encodeToString(bytes.copyOfRange(6, bytes.size), android.util.Base64.NO_WRAP)
        assertFalse(cache.acceptChunk(JSONObject().put("hash", hash).put("mimeType", "image/png").put("index", 1).put("chunks", 2).put("data", second)))
        assertTrue(cache.acceptChunk(JSONObject().put("hash", hash).put("mimeType", "image/png").put("index", 0).put("chunks", 2).put("data", first)))
        assertTrue(bytes.contentEquals(cache.read(hash)))
        assertEquals("image/png", cache.mimeType(hash))
    }

    @Test
    fun completedAssetSurvivesTemporaryDiskFailure() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        val cache = DeckAssetCache(context)
        cache.clear()
        val bytes = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2)
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        fun chunk(index: Int, part: ByteArray) = JSONObject().put("hash", hash).put("mimeType", "image/png")
            .put("index", index).put("chunks", 2)
            .put("data", android.util.Base64.encodeToString(part, android.util.Base64.NO_WRAP))
        val temporary = java.io.File(context.cacheDir, "aether-deck-assets/$hash.tmp")
        temporary.mkdirs()
        val blocker = java.io.File(temporary, "blocked").apply { writeText("test") }
        assertFalse(cache.acceptChunk(chunk(0, bytes.copyOfRange(0, 5))))
        val last = chunk(1, bytes.copyOfRange(5, bytes.size))
        assertFalse(cache.acceptChunk(last))
        blocker.delete()
        temporary.delete()
        assertTrue(cache.acceptChunk(last))
        assertTrue(bytes.contentEquals(cache.read(hash)))
    }

    @Test
    fun assetCacheRejectsInvalidHashMalformedBase64AndDigestMismatch() {
        val cache = DeckAssetCache(org.robolectric.RuntimeEnvironment.getApplication())
        cache.clear()
        assertFalse(cache.acceptChunk(JSONObject("""{"hash":"abc","mimeType":"image/png","index":0,"chunks":1,"data":"Zm9v"}""")))
        val wrongHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        assertFalse(cache.acceptChunk(JSONObject("""{"hash":"$wrongHash","mimeType":"image/png","index":0,"chunks":1,"data":"Zm9v"}""")))
        assertFalse(cache.contains(wrongHash))
        val validHash = "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"
        assertFalse(cache.acceptChunk(JSONObject("""{"hash":"$validHash","mimeType":"image/png","index":0,"chunks":1,"data":"%%%"}""")))
        assertFalse(cache.contains(validHash))

        val spoofed = "foobar".toByteArray()
        val spoofedHash = MessageDigest.getInstance("SHA-256").digest(spoofed).joinToString("") { "%02x".format(it) }
        assertFalse(cache.acceptChunk(JSONObject().put("hash", spoofedHash).put("mimeType", "image/png").put("index", 0).put("chunks", 1).put("data", "Zm9vYmFy")))
        assertFalse(cache.contains(spoofedHash))
    }

    @Test
    fun assetCacheEvictsOldestEntriesAtAggregateCountLimit() {
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        val cache = DeckAssetCache(context)
        cache.clear()
        val hashes = (0..32).map { index ->
            val bytes = byteArrayOf(
                0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                index.toByte()
            )
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val data = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
            assertTrue(cache.acceptChunk(JSONObject().put("hash", hash).put("mimeType", "image/png").put("index", 0).put("chunks", 1).put("data", data)))
            java.io.File(context.cacheDir, "aether-deck-assets/$hash.asset").setLastModified(index.toLong() + 1)
            hash
        }

        assertFalse(cache.contains(hashes.first()))
        assertTrue(cache.contains(hashes.last()))
        assertEquals(32, java.io.File(context.cacheDir, "aether-deck-assets").listFiles()?.count { it.extension == "asset" })
    }

    @Test
    fun clearingPendingAssetsReleasesTransferSlots() {
        val cache = DeckAssetCache(org.robolectric.RuntimeEnvironment.getApplication())
        cache.clear()
        repeat(16) { index ->
            val complete = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, index.toByte())
            val hash = MessageDigest.getInstance("SHA-256").digest(complete).joinToString("") { "%02x".format(it) }
            val first = android.util.Base64.encodeToString(complete.copyOfRange(0, 8), android.util.Base64.NO_WRAP)
            assertFalse(cache.acceptChunk(JSONObject().put("hash", hash).put("mimeType", "image/png").put("index", 0).put("chunks", 2).put("data", first)))
        }
        val finalBytes = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 99)
        val finalHash = MessageDigest.getInstance("SHA-256").digest(finalBytes).joinToString("") { "%02x".format(it) }
        val finalData = android.util.Base64.encodeToString(finalBytes, android.util.Base64.NO_WRAP)
        val completeMessage = JSONObject().put("hash", finalHash).put("mimeType", "image/png").put("index", 0).put("chunks", 1).put("data", finalData)
        assertFalse(cache.acceptChunk(completeMessage))
        cache.clearPending()
        assertTrue(cache.acceptChunk(completeMessage))
    }

    @Test
    fun snapshotPatchNavigationAndAssetMessagesStayRevisionSafe() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        val snapshot = JSONObject("""{
          "action":"DECK_SNAPSHOT","revision":4,"stateRevision":2,
          "activeDeckId":"deck","activePageId":"page",
          "document":{"schemaVersion":1,"revision":4,"stateRevision":2,"activeDeckId":"deck","activePageId":"page","variables":{"audio":{"volume":39}},"decks":[{"id":"deck","name":"Aether Deck","defaultPageId":"page","pages":[{"id":"page","name":"Главная","columns":4,"controls":[]}]}]}
        }""")
        assertTrue(store.handle(snapshot))
        assertEquals(4, store.state.value.configurationRevision)
        assertEquals(39, store.state.value.variables["audio.volume"])
        assertTrue(store.handle(JSONObject("""{"action":"DECK_STATE_PATCH","stateRevision":3,"variables":{"audio.volume":42}}""")))
        assertEquals(42, store.state.value.variables["audio.volume"])
        val updatedDocument = JSONObject(snapshot.getJSONObject("document").toString()).apply { put("revision", 5); remove("variables"); remove("controlStates") }
        assertTrue(store.applyPatch(JSONObject().put("action", "DECK_PATCH").put("fromRevision", 4).put("toRevision", 5).put("document", updatedDocument)))
        assertEquals(42, store.state.value.variables["audio.volume"])
        assertFalse(store.applyPatch(JSONObject("""{"action":"DECK_PATCH","fromRevision":2,"toRevision":3,"document":{}}""")))
        assertTrue(store.state.value.needsFullSync)
        store.requestDeckSync()
        assertEquals("DECK_SYNC_REQUEST", JSONObject(sent.last()).getString("action"))
        store.triggerControl("deck", "page", "button")
        assertEquals(5, JSONObject(sent.last()).getLong("revision"))
        val page = updatedDocument.getJSONArray("decks").getJSONObject(0).getJSONArray("pages").getJSONObject(0)
        page.getJSONArray("controls").put(JSONObject().put("id", "volume").put("type", "slider"))
        store.applySnapshot(JSONObject().put("document", updatedDocument))
        assertTrue(store.setSliderValue("deck", "page", "volume", 42.0))
        assertEquals(1, JSONObject(sent.last()).getLong("sequence"))
        store.handle(JSONObject("""{"action":"DECK_ACTION_RESULT","controlId":"button","status":"STALE_REVISION"}"""))
        assertTrue(store.state.value.needsFullSync)
        assertEquals("DECK_SYNC_REQUEST", JSONObject(sent.last()).getString("action"))
        assertEquals("DECK_ASSET_REQUEST", DeckProtocol.assetRequest("abc").getString("action"))
    }

    @Test
    fun statePatchesCannotGrowRetainedMapsPastSnapshotLimit() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        store.handle(navigationSnapshot())

        repeat(256) { index ->
            store.handle(JSONObject().put("action", "DECK_STATE_PATCH").put("stateRevision", index + 1)
                .put("variables", JSONObject().put("key-$index", index)))
        }
        store.handle(JSONObject().put("action", "DECK_STATE_PATCH").put("stateRevision", 257)
            .put("variables", JSONObject().put("overflow", true)))

        assertEquals(256, store.state.value.variables.size)
        assertFalse(store.state.value.variables.containsKey("overflow"))
        assertTrue(store.state.value.needsFullSync)
        assertEquals("DECK_SYNC_REQUEST", JSONObject(sent.last()).getString("action"))

        store.handle(JSONObject().put("action", "DECK_STATE_PATCH").put("stateRevision", 258)
            .put("variables", JSONObject().put("key-0", "updated")))
        assertEquals(256, store.state.value.variables.size)
        assertEquals("updated", store.state.value.variables["key-0"])
    }

    @Test
    fun statePatchesHaveAnAggregateRetainedByteBudget() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        store.handle(navigationSnapshot())
        repeat(256) { index ->
            store.handle(JSONObject().put("action", "DECK_STATE_PATCH").put("stateRevision", index + 1)
                .put("variables", JSONObject().put("large-$index", "x".repeat(4096))))
        }
        assertTrue(store.state.value.variables.size < 256)
        assertTrue(store.state.value.needsFullSync)
        assertEquals("DECK_SYNC_REQUEST", JSONObject(sent.last()).getString("action"))
    }

    @Test
    fun snapshotBoundsCustomAssetsPerPage() {
        val controls = org.json.JSONArray()
        repeat(24) { index ->
            controls.put(JSONObject().put("id", "asset-$index").put("type", "button")
                .put("icon", JSONObject().put("hash", "%064x".format(index + 1))))
        }
        val document = JSONObject().put("decks", org.json.JSONArray().put(
            JSONObject().put("id", "deck").put("defaultPageId", "page").put("pages", org.json.JSONArray().put(
                JSONObject().put("id", "page").put("columns", 4).put("controls", controls)
            ))
        ))
        val store = DeckStore { }
        store.applySnapshot(JSONObject().put("document", document))

        assertEquals(16, store.state.value.activePage!!.controls.count { it.iconHash != null })
    }

    @Test
    fun repeatedAssetHashConsumesOnlyOnePageAssetSlot() {
        val controls = org.json.JSONArray()
        val sharedHash = "a".repeat(64)
        repeat(24) { index ->
            controls.put(JSONObject().put("id", "asset-$index").put("type", "button")
                .put("icon", JSONObject().put("hash", sharedHash)))
        }
        val document = JSONObject().put("decks", org.json.JSONArray().put(
            JSONObject().put("id", "deck").put("defaultPageId", "page").put("pages", org.json.JSONArray().put(
                JSONObject().put("id", "page").put("columns", 4).put("controls", controls)
            ))
        ))
        val store = DeckStore { }
        store.applySnapshot(JSONObject().put("document", document))
        assertEquals(24, store.state.value.activePage!!.controls.count { it.iconHash == sharedHash })
    }

    @Test
    fun sparseStateForControlsAfterFirst256RemainsValid() {
        val pages = org.json.JSONArray()
        repeat(3) { pageIndex ->
            val controls = org.json.JSONArray()
            repeat(100) { controlIndex -> controls.put(JSONObject().put("id", "c-${pageIndex * 100 + controlIndex}").put("type", "button")) }
            pages.put(JSONObject().put("id", "page-$pageIndex").put("columns", 4).put("controls", controls))
        }
        val document = JSONObject().put("controlStates", JSONObject().put("c-299", JSONObject().put("active", true)))
            .put("decks", org.json.JSONArray().put(JSONObject().put("id", "deck").put("defaultPageId", "page-0").put("pages", pages)))
        val store = DeckStore { }
        store.applySnapshot(JSONObject().put("document", document))
        assertEquals(true, store.state.value.controlStates["c-299"]?.get("active"))
        store.handle(JSONObject().put("action", "DECK_STATE_PATCH").put("stateRevision", 1)
            .put("states", JSONObject().put("c-299", JSONObject().put("active", false))))
        assertEquals(false, store.state.value.controlStates["c-299"]?.get("active"))
    }

    @Test
    fun hostileSnapshotCountsAndGridValuesAreBounded() {
        val controls = org.json.JSONArray()
        repeat(200) { index ->
            controls.put(JSONObject().put("id", "c$index").put("column", 99).put("columnSpan", 999).put("row", Int.MAX_VALUE).put("rowSpan", Int.MAX_VALUE))
        }
        val document = JSONObject().put("decks", org.json.JSONArray().put(
            JSONObject().put("id", "deck").put("defaultPageId", "page").put("pages", org.json.JSONArray().put(
                JSONObject().put("id", "page").put("columns", 4).put("controls", controls)
            ))
        ))
        val store = DeckStore { }
        store.applySnapshot(JSONObject().put("document", document))

        val page = store.state.value.activePage!!
        assertEquals(128, page.controls.size)
        assertTrue(page.controls.all { it.column in 0..3 && it.columnSpan in 1..4 })
        assertTrue(page.controls.all { it.row in 0..63 && it.rowSpan in 1..16 })
    }

    @Test
    fun staleSnapshotsBackwardPatchesAndInvalidNavigationCannotRollbackState() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        val current = navigationSnapshot().apply {
            put("revision", 5)
            getJSONObject("document").put("revision", 5)
        }
        store.handle(current)

        val stale = navigationSnapshot().apply {
            put("revision", 4)
            getJSONObject("document").put("revision", 4)
        }
        store.handle(stale)
        assertEquals(5, store.state.value.configurationRevision)

        val document = JSONObject(current.getJSONObject("document").toString())
        assertFalse(store.applyPatch(JSONObject().put("fromRevision", 5).put("toRevision", 5).put("document", document)))
        assertEquals(5, store.state.value.configurationRevision)
        assertTrue(store.state.value.needsFullSync)

        store.handle(JSONObject().put("action", "DECK_NAVIGATION").put("deckId", "deck").put("pageId", "deleted"))
        assertEquals("root", store.state.value.activePageId)
        assertEquals("DECK_SYNC_REQUEST", JSONObject(sent.last()).getString("action"))
    }

    @Test
    fun sliderOutputIsFiniteClampedAndAlignedToConfiguredStep() {
        val sent = mutableListOf<String>()
        val store = DeckStore { sent += it }
        val snapshot = navigationSnapshot()
        snapshot.getJSONObject("document")
            .getJSONArray("decks").getJSONObject(0)
            .getJSONArray("pages").getJSONObject(0)
            .getJSONArray("controls")
            .put(JSONObject().put("id", "volume").put("type", "slider").put("minimum", 0).put("maximum", 10).put("step", 2))
        store.handle(snapshot)

        assertFalse(store.setSliderValue("deck", "root", "volume", Double.NaN))
        assertTrue(store.setSliderValue("deck", "root", "volume", 9.1))
        assertEquals(10.0, JSONObject(sent.last()).getDouble("value"), 0.0)
    }
}
