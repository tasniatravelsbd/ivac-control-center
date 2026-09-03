package com.ivac.smscollector

import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.io.IOException

sealed interface UploadOutcome {
    data object Sent : UploadOutcome
    data class Retry(val code: String) : UploadOutcome
    data class Failed(val code: String) : UploadOutcome
}

sealed interface PairingOutcome {
    data class Paired(
        val backendUrl: String,
        val deviceName: String,
        val deviceIdentifier: String,
        val receiverNumber: String,
        val apiKey: String,
    ) : PairingOutcome
    data class Failed(val code: String) : PairingOutcome
}

class CollectorApi(private val config: CollectorConfigStore) {
    private fun endpoint(path: String): URL? {
        val base = config.read().backendUrl
        val allowed = base.startsWith("https://") || (BuildConfig.DEBUG && base.startsWith("http://"))
        if (!allowed) return null
        return URL("$base$path")
    }

    private fun endpoint(base: String, path: String): URL? {
        val normalized = base.trim().trimEnd('/')
        val allowed = normalized.startsWith("https://") || (BuildConfig.DEBUG && normalized.startsWith("http://"))
        return if (allowed) URL("$normalized$path") else null
    }

    private data class Reply(val statusCode: Int?, val body: String?)

    private fun post(path: String, payload: JSONObject): Reply {
        val apiKey = config.apiKey() ?: return Reply(401, null)
        val connection = (endpoint(path)?.openConnection() as? HttpURLConnection) ?: return Reply(400, null)
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.setRequestProperty("X-Collector-Key", apiKey)
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(payload.toString()) }
            val status = connection.responseCode
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            Reply(status, body)
        } catch (_: IOException) {
            Reply(null, null)
        } finally {
            connection.disconnect()
        }
    }

    /** Exchanges a short-lived code once. This request deliberately has no collector credential yet. */
    fun pair(backendUrl: String, pairingCode: String): PairingOutcome {
        val connection = try {
            endpoint(backendUrl, "/api/collectors/pair")?.openConnection() as? HttpURLConnection
        } catch (_: Exception) {
            null
        } ?: return PairingOutcome.Failed("INVALID_BACKEND_URL")
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use {
                it.write(JSONObject().put("pairingCode", pairingCode.trim()).toString())
            }
            val status = connection.responseCode
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            if (status !in 200..299 || body == null) {
                return PairingOutcome.Failed(if (status == 410 || status == 422) "PAIRING_REJECTED" else "HTTP_$status")
            }
            val payload = JSONObject(body)
            val collector = payload.getJSONObject("collector")
            PairingOutcome.Paired(
                backendUrl = payload.getString("backendUrl"),
                deviceName = collector.getString("deviceName"),
                deviceIdentifier = collector.getString("deviceIdentifier"),
                receiverNumber = collector.getString("phoneNumber"),
                apiKey = payload.getString("apiKey"),
            )
        } catch (_: IOException) {
            PairingOutcome.Failed("NETWORK")
        } catch (_: Exception) {
            PairingOutcome.Failed("MALFORMED_RESPONSE")
        } finally {
            connection.disconnect()
        }
    }

    fun heartbeat(): UploadOutcome {
        val current = config.read()
        val reply = post("/api/collectors/heartbeat", JSONObject().put("deviceIdentifier", current.deviceIdentifier))
        return when (reply.statusCode) {
            in 200..299 -> if (reply.body?.let { runCatching { JSONObject(it).getString("status") }.isSuccess } == true) UploadOutcome.Sent else UploadOutcome.Retry("MALFORMED_RESPONSE")
            401, 403, 422 -> UploadOutcome.Failed("HTTP_${reply.statusCode}")
            null -> UploadOutcome.Retry("NETWORK")
            else -> UploadOutcome.Retry("HTTP_${reply.statusCode}")
        }
    }

    fun upload(message: QueuedSms): UploadOutcome {
        val current = config.read()
        val reply = post("/api/sms", JSONObject()
            .put("deviceIdentifier", current.deviceIdentifier)
            .put("messageUid", message.messageUid)
            .put("receiverNumber", message.receiverNumber)
            .put("senderNumber", message.senderNumber)
            .put("message", message.body)
            .put("receivedAt", java.time.Instant.ofEpochMilli(message.receivedAtMillis).toString()))
        return when (reply.statusCode) {
            409 -> UploadOutcome.Sent // Backend messageUid deduplication.
            in 200..299 -> if (reply.body?.let { runCatching { JSONObject(it).getString("status") }.isSuccess } == true) UploadOutcome.Sent else UploadOutcome.Retry("MALFORMED_RESPONSE")
            401, 403, 422 -> UploadOutcome.Failed("HTTP_${reply.statusCode}")
            null -> UploadOutcome.Retry("NETWORK")
            else -> UploadOutcome.Retry("HTTP_${reply.statusCode}")
        }
    }
}
