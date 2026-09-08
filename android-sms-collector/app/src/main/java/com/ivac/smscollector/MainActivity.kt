package com.ivac.smscollector

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {
    private val config by lazy { CollectorConfigStore(this) }
    private lateinit var content: LinearLayout
    private lateinit var status: TextView
    private var registrationMode = RegistrationMode.PHONE
    private val requestSmsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshStatus() }

    private enum class RegistrationMode { PHONE, PAIRING_CODE }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 32, 32, 32) }
        setContentView(ScrollView(this).apply { addView(content) })
        render()
    }

    private fun render() {
        content.removeAllViews()
        content.addView(TextView(this).apply {
            text = "IVAC SMS Collector\nOnly incoming SMS messages are queued. No contacts, call logs, files, or browser data are collected."
            textSize = 18f
        })
        if (config.read().hasApiKey) renderConnected() else renderRegistration()
    }

    private fun renderRegistration() {
        content.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(Button(this@MainActivity).apply {
                text = "REGISTER DEVICE"
                isEnabled = registrationMode != RegistrationMode.PHONE
                setOnClickListener { registrationMode = RegistrationMode.PHONE; render() }
            })
            addView(Button(this@MainActivity).apply {
                text = "PAIRING CODE"
                isEnabled = registrationMode != RegistrationMode.PAIRING_CODE
                setOnClickListener { registrationMode = RegistrationMode.PAIRING_CODE; render() }
            })
        })
        if (registrationMode == RegistrationMode.PAIRING_CODE) {
            renderPairingCode()
        } else {
            renderPhoneRegistration()
        }
    }

    private fun renderPhoneRegistration() {
        val current = config.read()
        val backend = EditText(this).apply {
            hint = "Backend URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(current.backendUrl)
        }
        val deviceName = EditText(this).apply {
            hint = "Device name"
            setText(current.deviceName.ifBlank { android.os.Build.MODEL.take(80) })
        }
        val receivingNumber = EditText(this).apply {
            hint = "Receiving SIM / phone number"
            inputType = InputType.TYPE_CLASS_PHONE
            setText(current.receiverNumber)
        }
        content.addView(TextView(this).apply { text = "CONNECT DEVICE\nThis phone creates a secure local identity. An authenticated operator approves the exact pending device and SIM number in the Control Center. No pairing code is required." })
        content.addView(backend)
        content.addView(deviceName)
        content.addView(receivingNumber)
        content.addView(Button(this).apply {
            text = "CONNECT DEVICE"
            setOnClickListener { connectDevice(backend.text.toString(), deviceName.text.toString(), receivingNumber.text.toString()) }
        })
        content.addView(Button(this).apply {
            text = "CHECK REGISTRATION"
            isEnabled = current.hasRegistrationSecret
            setOnClickListener { checkRegistration() }
        })
        status = TextView(this)
        content.addView(status)
        status.text = if (current.hasRegistrationSecret) "Registration requested. Ask an operator to approve this device, then check registration." else "Not connected. The permanent collector credential is never displayed in this app."
    }

    /** Legacy one-time code pairing remains available for already deployed collector APK workflows. */
    private fun renderPairingCode() {
        val current = config.read()
        val backend = EditText(this).apply {
            hint = "Backend URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(current.backendUrl)
        }
        val pairingCode = EditText(this).apply {
            hint = "Pairing code"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        content.addView(TextView(this).apply {
            text = "PAIR DEVICE\nEnter the short-lived code generated by the Control Center. The permanent collector credential is never displayed."
        })
        content.addView(backend)
        content.addView(pairingCode)
        content.addView(Button(this).apply {
            text = "PAIR DEVICE"
            setOnClickListener { pairDevice(backend.text.toString(), pairingCode.text.toString()) }
        })
        status = TextView(this)
        content.addView(status)
        status.text = "Not paired. Use this mode only with a one-time operator pairing code."
    }

    private fun renderConnected() {
        val value = config.read()
        content.addView(TextView(this).apply {
            text = "CONNECTED\nCollector: ${value.deviceName}\nReceiving number: ${value.receiverNumber}\nBackend: ${value.backendUrl}"
        })
        content.addView(Button(this).apply { text = "Grant SMS permission"; setOnClickListener { requestSmsPermission.launch(Manifest.permission.RECEIVE_SMS) } })
        content.addView(Button(this).apply { text = "Send heartbeat now"; setOnClickListener { CollectorWork.enqueueHeartbeat(this@MainActivity); refreshStatus() } })
        content.addView(Button(this).apply { text = "Retry pending"; setOnClickListener { retryPending() } })
        if (BuildConfig.DEBUG) content.addView(Button(this).apply { text = "Queue TEST MESSAGE"; setOnClickListener { queueTestMessage() } })
        content.addView(Button(this).apply {
            text = "Change backend / re-register"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage("This removes this phone's local credential and identity. Register this device again, then have an operator approve it in the Control Center.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Re-register") { _, _ -> config.clearRegistration(); render() }
                    .show()
            }
        })
        status = TextView(this)
        content.addView(status)
        refreshStatus()
    }

    private fun connectDevice(backendUrl: String, deviceName: String, receiverNumber: String) = lifecycleScope.launch {
        status.text = "Connecting device…"
        val outcome = withContext(Dispatchers.IO) {
            val current = config.beginRegistration(backendUrl, deviceName, receiverNumber)
            CollectorApi(config).registerDevice(
                current.backendUrl,
                current.deviceName,
                current.deviceIdentifier,
                current.receiverNumber,
                config.registrationSecret().orEmpty(),
            )
        }
        when (outcome) {
            RegistrationOutcome.PendingApproval -> status.text = "Registration requested. Ask an operator to approve this exact device and SIM number, then tap Check registration."
            is RegistrationOutcome.Connected -> completeConnectedRegistration(outcome)
            is RegistrationOutcome.Failed -> status.text = "Connection failed: ${outcome.code}"
        }
    }

    private fun checkRegistration() = lifecycleScope.launch {
        val current = config.read()
        val registrationSecret = config.registrationSecret()
        if (registrationSecret.isNullOrBlank()) {
            status.text = "Start device registration first."
            return@launch
        }
        status.text = "Checking registration…"
        when (val outcome = withContext(Dispatchers.IO) {
            CollectorApi(config).completeRegistration(current.backendUrl, current.deviceIdentifier, registrationSecret)
        }) {
            RegistrationOutcome.PendingApproval -> status.text = "Awaiting operator approval for this device."
            is RegistrationOutcome.Connected -> completeConnectedRegistration(outcome)
            is RegistrationOutcome.Failed -> status.text = "Registration check failed: ${outcome.code}"
        }
    }

    private fun completeConnectedRegistration(outcome: RegistrationOutcome.Connected) {
        val current = config.read()
        config.saveRegistered(
            current.backendUrl,
            outcome.deviceName.ifBlank { current.deviceName },
            outcome.deviceIdentifier.ifBlank { current.deviceIdentifier },
            outcome.receiverNumber.ifBlank { current.receiverNumber },
            outcome.apiKey,
        )
        CollectorWork.scheduleHeartbeat(this@MainActivity)
        CollectorWork.scheduleRecovery(this@MainActivity)
        CollectorWork.enqueueHeartbeat(this@MainActivity)
        render()
    }

    private fun pairDevice(backendUrl: String, pairingCode: String) = lifecycleScope.launch {
        status.text = "Pairing device…"
        when (val outcome = withContext(Dispatchers.IO) { CollectorApi(config).pair(backendUrl, pairingCode) }) {
            is PairingOutcome.Paired -> {
                config.saveRegistered(
                    outcome.backendUrl,
                    outcome.deviceName,
                    outcome.deviceIdentifier,
                    outcome.receiverNumber,
                    outcome.apiKey,
                )
                CollectorWork.scheduleHeartbeat(this@MainActivity)
                CollectorWork.scheduleRecovery(this@MainActivity)
                CollectorWork.enqueueHeartbeat(this@MainActivity)
                render()
            }
            is PairingOutcome.Failed -> status.text = "Pairing failed: ${outcome.code}"
        }
    }

    private fun retryPending() = lifecycleScope.launch {
        withContext(Dispatchers.IO) { SmsQueueRepository(this@MainActivity).retryFailed() }
        CollectorWork.enqueueUpload(this@MainActivity)
        refreshStatus()
    }
    private fun queueTestMessage() = lifecycleScope.launch {
        withContext(Dispatchers.IO) { SmsQueueRepository(this@MainActivity).enqueueTestMessage() }
        CollectorWork.enqueueUpload(this@MainActivity)
        CollectorWork.scheduleRecovery(this@MainActivity)
        refreshStatus()
    }
    private fun refreshStatus() = lifecycleScope.launch {
        val queue = withContext(Dispatchers.IO) { val dao = CollectorDatabase.get(this@MainActivity).messages(); Triple(dao.pendingCount(), dao.sentCount(), dao.problemCount()) }
        val value = config.read()
        val heartbeat = config.heartbeatSummary()
        val upload = config.uploadSummary()
        val permission = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
        val lastHeartbeat = heartbeat.second.takeIf { it > 0 }?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "never"
        val lastUpload = upload.second.takeIf { it > 0 }?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "never"
        val lastSuccessfulUpload = config.lastSuccessfulUploadAt().takeIf { it > 0 }?.let { java.text.DateFormat.getDateTimeInstance().format(java.util.Date(it)) } ?: "never"
        status.text = "Permission: ${if (permission) "granted" else "required"}\nRegistration: ${if (value.hasApiKey) "configured" else "operator provisioning required"}\nConnection: ${heartbeat.first}\nLast heartbeat: $lastHeartbeat\nLast upload result: ${upload.first} ($lastUpload)\nLast successful upload: $lastSuccessfulUpload\nPending: ${queue.first}\nSent: ${queue.second}\nFailed/retrying: ${queue.third}\nHeartbeat: scheduled every 15 minutes when configured"
    }
}
