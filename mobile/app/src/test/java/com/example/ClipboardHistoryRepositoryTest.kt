package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.data.ClipboardHistoryRepository
import com.example.data.ClipboardHistoryDatabase
import com.example.data.ClipboardHistoryItem
import com.example.data.MAX_CLIPBOARD_HISTORY_CHARS
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ClipboardHistoryRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val repository = ClipboardHistoryRepository(context)

    @Before
    fun clearHistory() = runBlocking {
        repository.clear()
    }

    @Test
    fun `eleventh item removes oldest and keeps insertion order`() = runBlocking {
        (1..11).forEach { repository.add("Текст $it") }

        val items = withTimeout(5_000) { repository.items.first { it.size == 10 } }

        assertEquals(10, items.size)
        assertEquals("Текст 11", items.first().text)
        assertEquals("Текст 2", items.last().text)
    }

    @Test
    fun `blank clipboard values are ignored`() = runBlocking {
        repository.add("   ")

        assertEquals(emptyList<Any>(), withTimeout(5_000) { repository.items.first() })
    }

    @Test
    fun `duplicate simultaneous clipboard events create one card`() = runBlocking {
        List(2) { async { repository.add("Один текст") } }.awaitAll()

        val items = withTimeout(5_000) { repository.items.first { it.isNotEmpty() } }
        assertEquals(listOf("Один текст"), items.map { it.text })
    }

    @Test
    fun `reusing existing text moves it to top without duplicating it`() = runBlocking {
        repository.add("A")
        repository.add("B")
        repository.add("A")

        val items = withTimeout(5_000) { repository.items.first { it.size == 2 && it.first().text == "A" } }
        assertEquals(listOf("A", "B"), items.map { it.text })
        assertEquals("phone", items.first().source)
    }

    @Test
    fun `oversized clipboard text is ignored`() = runBlocking {
        repository.add("x".repeat(MAX_CLIPBOARD_HISTORY_CHARS + 1))

        assertEquals(emptyList<Any>(), withTimeout(5_000) { repository.items.first() })
    }

    @Test
    fun `duplicate cards left by an older version are cleaned up`() = runBlocking {
        val dao = ClipboardHistoryDatabase.get(context).history()
        dao.insert(ClipboardHistoryItem(text = "Старый дубль", source = "phone"))
        dao.insert(ClipboardHistoryItem(text = "Старый дубль", source = "phone"))

        repository.cleanUpDuplicates()

        val items = withTimeout(5_000) { repository.items.first { it.isNotEmpty() } }
        assertEquals(listOf("Старый дубль"), items.map { it.text })
    }

    @Test
    fun `legacy automatically stored PC clipboard entries are purged`() = runBlocking {
        val dao = ClipboardHistoryDatabase.get(context).history()
        dao.insert(ClipboardHistoryItem(text = "Секрет с ПК", source = "pc"))
        dao.insert(ClipboardHistoryItem(text = "Отправлено пользователем", source = "phone"))

        repository.purgeLegacySensitiveEntries()

        val items = withTimeout(5_000) { repository.items.first { it.size == 1 } }
        assertEquals(listOf("Отправлено пользователем"), items.map { it.text })
        assertEquals(listOf("phone"), items.map { it.source })
    }
}
