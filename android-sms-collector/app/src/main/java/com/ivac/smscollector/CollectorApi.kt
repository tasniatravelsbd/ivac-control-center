package com.ivac.smscollector

import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
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

sealed interface RegistrationOutcome {
    data object PendingApproval : RegistrationOutcome

    data class Connected(
        val deviceName: String,
        val deviceIdentifier: String,
        val receiverNumber: String,
        val apiKey: String,
    ) : RegistrationOutcome

    data class Failed(val code: String) : RegistrationOutcome
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

    private fun unauthenticatedPost(base: String, path: String, payload: JSONObject): Reply {
        val connection = try {
            endpoint(base, path)?.openConnection() as? HttpURLConnection
        } catch (_: Exception) {
            null
        } ?: return Reply(400, null)
        return try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
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

    private fun registrationReply(reply: Reply): RegistrationOutcome = when (reply.statusCode) {
        202 -> RegistrationOutcome.PendingApproval
        200 -> try {
            val payload = JSONObject(reply.body ?: return RegistrationOutcome.Failed("MALFORMED_RESPONSE"))
            val collector = payload.getJSONObject("collector")
            val apiKey = payload.optString("apiKey").trim()
            if (payload.optString("registrationStatus") != "CONNECTED" || apiKey.isBlank()) {
                RegistrationOutcome.Failed("MALFORMED_RESPONSE")
            } else {
                RegistrationOutcome.Connected(
                    deviceName = collector.optString("deviceName"),
                    deviceIdentifier = collector.optString("deviceIdentifier"),
                    receiverNumber = collector.optString("phoneNumber"),
                    apiKey = apiKey,
                )
            }
        } catch (_: Exception) {
            RegistrationOutcome.Failed("MALFORMED_RESPONSE")
        }
        null -> RegistrationOutcome.Failed("NETWORK")
        else -> try {
            RegistrationOutcome.Failed(JSONObject(reply.body ?: "{}").optString("error").ifBlank { "HTTP_${reply.statusCode}" })
        } catch (_: Exception) {
            RegistrationOutcome.Failed("HTTP_${reply.statusCode}")
        }
    }

    /** Direct phone/device registration; the returned credential is stored only in encrypted local storage. */
    fun registerDevice(
        backendUrl: String,
        deviceName: String,
        deviceIdentifier: String,
        receiverNumber: String,
        registrationSecret: String,
    ): RegistrationOutcome {
        if (deviceName.isBlank() || deviceIdentifier.isBlank() || receiverNumber.isBlank()) {
            return RegistrationOutcome.Failed("INVALID_REGISTRATION")
        }
        val reply = unauthenticatedPost(
            backendUrl,
            "/api/collectors/register",
            JSONObject()
                .put("deviceName", deviceName.trim())
                .put("deviceIdentifier", deviceIdentifier)
                .put("phoneNumber", receiverNumber.trim()),
        )
        if (reply.statusCode !in 200..299) return registrationReply(reply)
        return try {
            val payload = JSONObject(reply.body ?: return RegistrationOutcome.Failed("MALFORMED_RESPONSE"))
            val collector = payload.getJSONObject("collector")
            val apiKey = payload.optString("apiKey").trim()
            if (apiKey.isBlank()) RegistrationOutcome.Failed("MALFORMED_RESPONSE") else RegistrationOutcome.Connected(
                collector.optString("deviceName"), collector.optString("deviceIdentifier"), collector.optString("phoneNumber"), apiKey,
            )
        } catch (_: Exception) { RegistrationOutcome.Failed("MALFORMED_RESPONSE") }
    }

    /** Obtains a credential only after the authenticated operator has approved this exact registration. */
    fun completeRegistration(
        backendUrl: String,
        deviceIdentifier: String,
        registrationSecret: String,
    ): RegistrationOutcome {
        if (deviceIdentifier.isBlank() || registrationSecret.length < 32) {
            return RegistrationOutcome.Failed("INVALID_REGISTRATION")
        }
        val encodedId = URLEncoder.encode(deviceIdentifier, Charsets.UTF_8.name())
        val connection = try {
            endpoint(backendUrl, "/api/collectors/device-registrations/$encodedId")?.openConnection() as? HttpURLConnection
        } catch (_: Exception) {
            null
        } ?: return RegistrationOutcome.Failed("INVALID_BACKEND_URL")
        val reply = try {
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("X-Registration-Secret", registrationSecret)
            val status = connection.responseCode
            val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }
            Reply(status, body)
        } catch (_: IOException) {
            Reply(null, null)
        } finally {
            connection.disconnect()
        }
        return registrationReply(reply)
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
