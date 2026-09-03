package com.ivac.smscollector

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

@Entity(tableName = "queued_sms")
data class QueuedSms(
    @PrimaryKey val messageUid: String,
    val senderNumber: String,
    val receiverNumber: String,
    val subscriptionId: Int?,
    val body: String,
    val receivedAtMillis: Long,
    val createdAtMillis: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
    val state: String = "PENDING",
    val lastError: String? = null,
)

@Dao
interface QueuedSmsDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(message: QueuedSms): Long

    @Query("SELECT * FROM queued_sms WHERE state IN ('PENDING', 'RETRY') ORDER BY createdAtMillis ASC LIMIT :limit")
    suspend fun pending(limit: Int = 20): List<QueuedSms>

    @Query("UPDATE queued_sms SET state = 'SENT', lastError = NULL WHERE messageUid = :uid")
    suspend fun sent(uid: String)

    @Query("UPDATE queued_sms SET state = 'RETRY', retryCount = retryCount + 1, lastError = :error WHERE messageUid = :uid")
    suspend fun retry(uid: String, error: String)

    @Query("UPDATE queued_sms SET state = 'FAILED', lastError = :error WHERE messageUid = :uid")
    suspend fun failed(uid: String, error: String)

    @Query("UPDATE queued_sms SET state = 'PENDING', lastError = NULL WHERE state = 'FAILED'")
    suspend fun requeueFailed(): Int

    @Query("UPDATE queued_sms SET state = 'PENDING', lastError = NULL WHERE messageUid = :uid")
    suspend fun requeue(uid: String)

    @Query("SELECT COUNT(*) FROM queued_sms WHERE state IN ('PENDING', 'RETRY')")
    suspend fun pendingCount(): Int

    @Query("SELECT COUNT(*) FROM queued_sms WHERE state = 'SENT'")
    suspend fun sentCount(): Int

    @Query("SELECT COUNT(*) FROM queued_sms WHERE state IN ('RETRY', 'FAILED')")
    suspend fun problemCount(): Int
}

class SmsQueueRepository(private val context: Context) {
    private val dao = CollectorDatabase.get(context).messages()

    suspend fun enqueue(message: QueuedSms): Boolean = dao.insert(message) != -1L

    suspend fun enqueueTestMessage(): Boolean {
        val uid = "test-message-v1"
        val inserted = dao.insert(QueuedSms(
            messageUid = uid,
            senderNumber = "TEST",
            receiverNumber = "TEST-SIM",
            subscriptionId = null,
            body = "Your OTP is 123456",
            receivedAtMillis = System.currentTimeMillis(),
        )) != -1L
        if (!inserted) dao.requeue(uid)
        return inserted
    }

    suspend fun retryFailed(): Int = dao.requeueFailed()
}

@Database(entities = [QueuedSms::class], version = 1, exportSchema = true)
abstract class CollectorDatabase : RoomDatabase() {
    abstract fun messages(): QueuedSmsDao

    companion object {
        @Volatile private var instance: CollectorDatabase? = null
        fun get(context: Context): CollectorDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, CollectorDatabase::class.java, "collector.db").build().also { instance = it }
        }
    }
}
