package com.ivac.smscollector

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SubscriptionManager
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.security.MessageDigest

class IncomingSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val pending = goAsync()
        val subscriptionId = intent.getIntExtra(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX, SubscriptionManager.INVALID_SUBSCRIPTION_ID)
            .takeIf { it != SubscriptionManager.INVALID_SUBSCRIPTION_ID }
        val store = CollectorConfigStore(context)
        val receiverNumber = store.read().receiverNumber
        if (receiverNumber.isBlank()) { pending.finish(); return }
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dao = CollectorDatabase.get(context).messages()
                Telephony.Sms.Intents.getMessagesFromIntent(intent).groupBy { sms ->
                    "${sms.displayOriginatingAddress.orEmpty()}|${sms.timestampMillis}"
                }.forEach { (_, parts) ->
                    val first = parts.first()
                    val receivedAt = first.timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()
                    val sender = first.displayOriginatingAddress.orEmpty()
                    val body = parts.joinToString(separator = "") { it.messageBody.orEmpty() }
                    val uid = Base64.encodeToString(
                        MessageDigest.getInstance("SHA-256").digest("$sender|$receivedAt|$subscriptionId|$body".toByteArray()),
                        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
                    )
                    val inserted = SmsQueueRepository(context).enqueue(QueuedSms(uid, sender, receiverNumber, subscriptionId, body, receivedAt))
                    if (inserted) { CollectorWork.enqueueUpload(context); CollectorWork.scheduleRecovery(context) }
                }
            } finally {
                pending.finish()
            }
        }
    }
}
