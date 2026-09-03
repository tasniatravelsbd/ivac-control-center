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
    private val requestSmsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { refreshStatus() }

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
        if (config.read().hasApiKey) renderConnected() else renderPairing()
    }

    private fun renderPairing() {
        val backend = EditText(this).apply {
            hint = "Backend URL"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(config.read().backendUrl)
        }
        val pairingCode = EditText(this).apply {
            hint = "Pairing code"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        content.addView(TextView(this).apply { text = "PAIR DEVICE\nAsk an operator to create a short-lived pairing code in the control panel." })
        content.addView(backend)
        content.addView(pairingCode)
        content.addView(Button(this).apply {
            text = "PAIR DEVICE"
            setOnClickListener { pair(backend.text.toString(), pairingCode.text.toString()) }
        })
        status = TextView(this)
        content.addView(status)
        status.text = "Not paired. The permanent collector credential is never displayed in this app."
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
            text = "Change backend / re-pair"
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setMessage("This removes this phone's local pairing. Create a new pairing code in the control panel before pairing again.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Re-pair") { _, _ -> config.clearPairing(); render() }
                    .show()
            }
        })
        status = TextView(this)
        content.addView(status)
        refreshStatus()
    }

    private fun pair(backendUrl: String, pairingCode: String) = lifecycleScope.launch {
        status.text = "Pairing device…"
        val outcome = withContext(Dispatchers.IO) { CollectorApi(config).pair(backendUrl, pairingCode) }
        when (outcome) {
            is PairingOutcome.Paired -> {
                config.savePaired(outcome.backendUrl, outcome.deviceName, outcome.deviceIdentifier, outcome.receiverNumber, outcome.apiKey)
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
