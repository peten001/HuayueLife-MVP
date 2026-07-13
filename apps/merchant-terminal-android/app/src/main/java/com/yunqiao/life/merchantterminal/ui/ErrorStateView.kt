package com.yunqiao.life.merchantterminal.ui

import android.content.Context
import android.util.AttributeSet
import android.view.LayoutInflater
import android.widget.FrameLayout
import androidx.core.view.isVisible
import com.yunqiao.life.merchantterminal.databinding.ViewErrorStateBinding
import com.yunqiao.life.merchantterminal.web.TerminalLoadError

class ErrorStateView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {

    private val binding = ViewErrorStateBinding.inflate(LayoutInflater.from(context), this, true)

    var onRetry: (() -> Unit)? = null
    var onOpenNetworkSettings: (() -> Unit)? = null
    var onOpenDiagnostics: (() -> Unit)? = null

    init {
        binding.retryButton.setOnClickListener { onRetry?.invoke() }
        binding.networkSettingsButton.setOnClickListener { onOpenNetworkSettings?.invoke() }
        binding.diagnosticsButton.setOnClickListener { onOpenDiagnostics?.invoke() }
    }

    fun show(error: TerminalLoadError) {
        binding.errorTitleZh.text = error.type.titleZh
        binding.errorTitleVi.text = error.type.titleVi
        binding.errorDescription.text = buildString {
            append(error.type.descriptionZh)
            append('\n')
            append(error.type.descriptionVi)
        }
        binding.errorCode.text = error.diagnosticCode
        isVisible = true
        bringToFront()
    }

    fun hide() {
        isVisible = false
    }
}
