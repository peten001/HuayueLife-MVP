package com.yunqiao.life.merchantterminal.diagnostics

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.button.MaterialButton
import com.yunqiao.life.merchantterminal.R

/** A small, read-only support screen. It does not request or change any privileged setting. */
class DiagnosticsActivity : AppCompatActivity() {
    private lateinit var diagnosticsText: TextView
    private var latestDiagnostics: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_diagnostics)

        diagnosticsText = findViewById(R.id.diagnosticsText)
        findViewById<MaterialButton>(R.id.closeDiagnosticsButton).setOnClickListener { finish() }
        findViewById<MaterialButton>(R.id.copyDiagnosticsButton).setOnClickListener {
            copyDiagnostics()
        }
        findViewById<MaterialButton>(R.id.refreshDiagnosticsButton).setOnClickListener {
            refreshDiagnostics()
        }
        findViewById<MaterialButton>(R.id.openAppSettingsButton).setOnClickListener {
            openAppSettings()
        }
        findViewById<MaterialButton>(R.id.openBatterySettingsButton).setOnClickListener {
            openBatteryOptimizationSettings()
        }
        findViewById<MaterialButton>(R.id.openNetworkSettingsButton).setOnClickListener {
            openNetworkSettings()
        }

        refreshDiagnostics()
        enterImmersiveMode()
    }

    override fun onResume() {
        super.onResume()
        if (::diagnosticsText.isInitialized) refreshDiagnostics()
        enterImmersiveMode()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersiveMode()
    }

    private fun refreshDiagnostics() {
        latestDiagnostics = DeviceDiagnostics.collect(this).asDisplayText()
        diagnosticsText.text = latestDiagnostics
    }

    private fun copyDiagnostics() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(
            ClipData.newPlainText(getString(R.string.diagnostics_clip_label), latestDiagnostics),
        )
        Toast.makeText(this, R.string.diagnostics_copied, Toast.LENGTH_SHORT).show()
    }

    private fun openAppSettings() {
        val intent = Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", packageName, null),
        )
        launchSettings(intent, Intent(Settings.ACTION_SETTINGS))
    }

    private fun openBatteryOptimizationSettings() {
        launchSettings(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),
        )
    }

    private fun openNetworkSettings() {
        launchSettings(
            Intent(Settings.ACTION_WIRELESS_SETTINGS),
            Intent(Settings.ACTION_SETTINGS),
        )
    }

    private fun launchSettings(primary: Intent, fallback: Intent) {
        val launched = runCatching {
            startActivity(primary)
        }.isSuccess
        if (!launched) {
            val fallbackLaunched = runCatching { startActivity(fallback) }.isSuccess
            if (!fallbackLaunched) {
                Toast.makeText(this, R.string.diagnostics_settings_unavailable, Toast.LENGTH_SHORT)
                    .show()
            }
        }
    }

    private fun enterImmersiveMode() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
