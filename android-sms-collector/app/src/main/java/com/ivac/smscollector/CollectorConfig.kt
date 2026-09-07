package com.ivac.smscollector

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.security.SecureRandom
import java.util.UUID

data class CollectorConfig(
    val backendUrl: String,
    val deviceName: String,
    val deviceIdentifier: String,
    val receiverNumber: String,
    val hasApiKey: Boolean,
    val hasRegistrationSecret: Boolean,
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
        hasRegistrationSecret = !encrypted.getString("registration_secret", "").isNullOrBlank(),
    )

    fun apiKey(): String? = encrypted.getString("collector_api_key", null)

    fun registrationSecret(): String? = encrypted.getString("registration_secret", null)

    fun beginRegistration(backendUrl: String, deviceName: String, receiverNumber: String): CollectorConfig {
        if (registrationSecret().isNullOrBlank()) {
            val bytes = ByteArray(32)
            SecureRandom().nextBytes(bytes)
            encrypted.edit()
                .putString("registration_secret", Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
                .apply()
        }
        normal.edit()
            .putString("backend_url", backendUrl.trim().trimEnd('/'))
            .putString("device_name", deviceName.trim())
            .putString("receiver_number", receiverNumber.trim())
            .apply()
        return read()
    }

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

    /** Saves a one-time approved registration response. The credential remains in encrypted storage only. */
    fun saveRegistered(backendUrl: String, deviceName: String, deviceIdentifier: String, receiverNumber: String, apiKey: String) {
        save(backendUrl, deviceName, deviceIdentifier, receiverNumber, apiKey)
        encrypted.edit().remove("registration_secret").apply()
    }

    /** Re-registration is explicit; it clears the local identity and credential. */
    fun clearRegistration() {
        normal.edit()
            .remove("backend_url")
            .remove("device_name")
            .remove("device_identifier")
            .remove("receiver_number")
            .apply()
        encrypted.edit().remove("collector_api_key").remove("registration_secret").apply()
    }
}
