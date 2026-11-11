package com.example.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow

const val MAX_CLIPBOARD_HISTORY_CHARS = 100_000

@Entity(tableName = "clipboard_history")
data class ClipboardHistoryItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val text: String,
    val source: String,
    val createdAt: Long = System.currentTimeMillis()
)

@Dao
interface ClipboardHistoryDao {
    @Query("SELECT * FROM clipboard_history ORDER BY id DESC")
    fun observe(): Flow<List<ClipboardHistoryItem>>

    @Insert
    suspend fun insert(item: ClipboardHistoryItem)

    @Query("SELECT * FROM clipboard_history ORDER BY id DESC LIMIT 1")
    suspend fun latest(): ClipboardHistoryItem?

    @Query("SELECT * FROM clipboard_history WHERE text = :text ORDER BY id DESC LIMIT 1")
    suspend fun findLatestByText(text: String): ClipboardHistoryItem?

    @Query("SELECT * FROM clipboard_history ORDER BY id DESC")
    suspend fun snapshot(): List<ClipboardHistoryItem>

    @Query("DELETE FROM clipboard_history WHERE id NOT IN (SELECT id FROM clipboard_history ORDER BY id DESC LIMIT 10)")
    suspend fun trimToTen()

    @Query("DELETE FROM clipboard_history WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("DELETE FROM clipboard_history")
    suspend fun clear()

    @Query("DELETE FROM clipboard_history WHERE source != 'phone'")
    suspend fun deleteNonPhoneEntries()

    @Transaction
    suspend fun insertIfChangedAndTrim(item: ClipboardHistoryItem): Boolean {
        if (latest()?.text == item.text) return false
        findLatestByText(item.text)?.let { delete(it.id) }
        insert(item)
        trimToTen()
        return true
    }

    @Transaction
    suspend fun removeConsecutiveDuplicates() {
        var newer: ClipboardHistoryItem? = null
        snapshot().forEach { item ->
            if (newer?.text == item.text) delete(item.id) else newer = item
        }
    }
}

@Database(entities = [ClipboardHistoryItem::class], version = 1, exportSchema = false)
abstract class ClipboardHistoryDatabase : RoomDatabase() {
    abstract fun history(): ClipboardHistoryDao

    companion object {
        @Volatile private var instance: ClipboardHistoryDatabase? = null

        fun get(context: Context): ClipboardHistoryDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ClipboardHistoryDatabase::class.java,
                "aether_clipboard_history.db"
            ).fallbackToDestructiveMigration(dropAllTables = true).build().also { instance = it }
        }
    }
}

class ClipboardHistoryRepository(context: Context) {
    private val dao = ClipboardHistoryDatabase.get(context).history()
    val items: Flow<List<ClipboardHistoryItem>> = dao.observe()

    suspend fun add(text: String) {
        if (text.length > MAX_CLIPBOARD_HISTORY_CHARS) return
        val normalized = text.trim()
        if (normalized.isEmpty()) return
        dao.insertIfChangedAndTrim(ClipboardHistoryItem(text = normalized, source = "phone"))
    }

    suspend fun delete(id: Long) = dao.delete(id)
    suspend fun clear() = dao.clear()
    suspend fun cleanUpDuplicates() = dao.removeConsecutiveDuplicates()
    suspend fun purgeLegacySensitiveEntries() = dao.deleteNonPhoneEntries()
}
