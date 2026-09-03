package com.ivac.smscollector

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class SmsUploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val dao = CollectorDatabase.get(applicationContext).messages()
        val store = CollectorConfigStore(applicationContext)
        val api = CollectorApi(store)
        for (message in dao.pending()) when (val outcome = api.upload(message)) {
            UploadOutcome.Sent -> { dao.sent(message.messageUid); store.recordUpload("sent", successful = true) }
            is UploadOutcome.Retry -> { dao.retry(message.messageUid, outcome.code); store.recordUpload("retry: ${outcome.code}"); return Result.retry() }
            is UploadOutcome.Failed -> { dao.failed(message.messageUid, outcome.code); store.recordUpload("failed: ${outcome.code}") }
        }
        return Result.success()
    }
}

class HeartbeatWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val store = CollectorConfigStore(applicationContext)
        return when (val outcome = CollectorApi(store).heartbeat()) {
            UploadOutcome.Sent -> { store.recordHeartbeat("online"); Result.success() }
            is UploadOutcome.Retry -> { store.recordHeartbeat("retry: ${outcome.code}"); Result.retry() }
            is UploadOutcome.Failed -> { store.recordHeartbeat("failed: ${outcome.code}"); Result.failure() }
        }
    }
}

object CollectorWork {
    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun enqueueUpload(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "upload-queued-sms", ExistingWorkPolicy.KEEP,
            OneTimeWorkRequestBuilder<SmsUploadWorker>().setConstraints(network)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS).build(),
        )
    }

    fun scheduleRecovery(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "recover-pending-sms", ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<SmsUploadWorker>(15, TimeUnit.MINUTES).setConstraints(network).build(),
        )
    }

    fun enqueueHeartbeat(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            "collector-heartbeat-now", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<HeartbeatWorker>().setConstraints(network).build(),
        )
    }

    fun scheduleHeartbeat(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            "collector-heartbeat", ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<HeartbeatWorker>(15, TimeUnit.MINUTES).setConstraints(network).build(),
        )
    }
}
