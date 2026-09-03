package com.ivac.smscollector

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

data class CollectorConfig(
    val backendUrl: String,
    val deviceName: String,
    val deviceIdentifier: String,
    val receiverNumber: String,
    val hasApiKey: Boolean,
)

class CollectorConfigStore(context: Context) {
    private val normal = context.getSharedPreferences("collector_configuration", Context.MODE_PRIVATE)
    private val encrypted = EncryptedSharedPreferences.create(
        context,
        "collector_credentials",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun read() = CollectorConfig(
        backendUrl = normal.getString("backend_url", "") ?: "",
        deviceName = normal.getString("device_name", "") ?: "",
        deviceIdentifier = deviceIdentifier(),
        receiverNumber = normal.getString("receiver_number", "") ?: "",
        hasApiKey = !encrypted.getString("collector_api_key", "").isNullOrBlank(),
    )

    fun apiKey(): String? = encrypted.getString("collector_api_key", null)

    fun recordHeartbeat(status: String) {
        normal.edit().putString("last_heartbeat_status", status).putLong("last_heartbeat_at", System.currentTimeMillis()).apply()
    }

    fun heartbeatSummary(): Pair<String, Long> = (
        normal.getString("last_heartbeat_status", "not sent") ?: "not sent"
    ) to normal.getLong("last_heartbeat_at", 0)

    fun recordUpload(status: String, successful: Boolean = false) {
        val now = System.currentTimeMillis()
        normal.edit().putString("last_upload_status", status).putLong("last_upload_at", now)
            .apply { if (successful) putLong("last_successful_upload_at", now) }
            .apply()
    }

    fun uploadSummary(): Pair<String, Long> = (
        normal.getString("last_upload_status", "not sent") ?: "not sent"
    ) to normal.getLong("last_upload_at", 0)

    fun lastSuccessfulUploadAt(): Long = normal.getLong("last_successful_upload_at", 0)

    private fun deviceIdentifier(): String = normal.getString("device_identifier", null)?.takeIf { it.isNotBlank() }
        ?: UUID.randomUUID().toString().also { normal.edit().putString("device_identifier", it).apply() }

    fun save(backendUrl: String, deviceName: String, deviceIdentifier: String, receiverNumber: String, apiKey: String?) {
        normal.edit()
            .putString("backend_url", backendUrl.trim().trimEnd('/'))
            .putString("device_name", deviceName.trim())
            .putString("device_identifier", deviceIdentifier.trim())
            .putString("receiver_number", receiverNumber.trim())
            .apply()
        if (!apiKey.isNullOrBlank()) encrypted.edit().putString("collector_api_key", apiKey.trim()).apply()
    }

    /** Saves the one-time pairing response. The credential remains in encrypted storage only. */
    fun savePaired(backendUrl: String, deviceName: String, deviceIdentifier: String, receiverNumber: String, apiKey: String) {
        save(backendUrl, deviceName, deviceIdentifier, receiverNumber, apiKey)
    }

    /** Re-pairing is an explicit operator action; it clears the local credential before a new code is used. */
    fun clearPairing() {
        normal.edit()
            .remove("backend_url")
            .remove("device_name")
            .remove("receiver_number")
            .apply()
        encrypted.edit().remove("collector_api_key").apply()
    }
}
