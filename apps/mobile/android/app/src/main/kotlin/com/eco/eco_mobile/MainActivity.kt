package com.eco.eco_mobile

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val speechHandler = Handler(Looper.getMainLooper())
    private var speechRecognizer: SpeechRecognizer? = null
    private var speechResult: MethodChannel.Result? = null
    private var pendingLocale: String? = null
    private var speechRequestMode: SpeechRequestMode? = null
    private var speechTimeoutRunnable: Runnable? = null
    private var stopTimeoutRunnable: Runnable? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            SPEECH_CHANNEL,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "isAvailable" -> result.success(isSystemSpeechRecognitionAvailable())
                "recognize" -> recognize(call, result)
                "stop" -> stopRecognition(result)
                else -> result.notImplemented()
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != SPEECH_PERMISSION_REQUEST) {
            return
        }
        val granted = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            completeSpeechError("permission_denied", "需要麦克风权限")
            return
        }
        if (speechRequestMode == SpeechRequestMode.SERVICE) {
            startSpeechRecognitionService()
        }
    }

    @Deprecated("Deprecated in Android framework, still used for RecognizerIntent compatibility.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == SPEECH_ACTIVITY_REQUEST) {
            handleSpeechActivityResult(resultCode, data)
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onDestroy() {
        cleanupSpeechRecognizer()
        super.onDestroy()
    }

    private fun recognize(call: MethodCall, result: MethodChannel.Result) {
        if (speechResult != null) {
            result.error("busy", "正在识别上一段语音", null)
            return
        }
        pendingLocale = call.argument<String>("locale")

        if (SpeechRecognizer.isRecognitionAvailable(this)) {
            speechResult = result
            speechRequestMode = SpeechRequestMode.SERVICE
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), SPEECH_PERMISSION_REQUEST)
                return
            }
            startSpeechRecognitionService()
            return
        }

        if (isRecognitionActivityAvailable()) {
            speechResult = result
            speechRequestMode = SpeechRequestMode.ACTIVITY
            startSpeechRecognitionActivity()
            return
        }

        pendingLocale = null
        result.error("unavailable", NO_SYSTEM_ASR_MESSAGE, null)
    }

    private fun stopRecognition(result: MethodChannel.Result) {
        val recognizer = speechRecognizer
        if (speechResult == null) {
            result.success(null)
            return
        }
        if (speechRequestMode == SpeechRequestMode.ACTIVITY) {
            completeSpeechError("no_match", "语音识别已取消")
            result.success(null)
            return
        }
        if (recognizer == null) {
            completeSpeechError("no_match", "未识别到语音内容")
            result.success(null)
            return
        }
        try {
            recognizer.stopListening()
            scheduleStopTimeout()
        } catch (error: RuntimeException) {
            completeSpeechError("unavailable", error.message ?: "语音识别被中断")
        }
        result.success(null)
    }

    private fun startSpeechRecognitionService() {
        val currentResult = speechResult ?: return
        cleanupSpeechRecognizer(destroyPendingResult = false)

        val recognizer = SpeechRecognizer.createSpeechRecognizer(this)
        speechRecognizer = recognizer
        recognizer.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) = Unit
            override fun onEvent(eventType: Int, params: Bundle?) = Unit

            override fun onError(error: Int) {
                val mapped = mapSpeechError(error)
                completeSpeechError(mapped.first, mapped.second)
            }

            override fun onResults(results: Bundle?) {
                val text = results
                    ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    ?.firstOrNull()
                    ?.trim()
                    .orEmpty()
                if (text.isEmpty()) {
                    completeSpeechError("no_match", "未识别到语音内容")
                    return
                }
                completeSpeechSuccess(text)
            }
        })

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            applySpeechIntentExtras()
        }

        try {
            recognizer.startListening(intent)
            scheduleSpeechTimeout()
        } catch (error: RuntimeException) {
            cleanupSpeechRecognizer(destroyPendingResult = false)
            speechResult = currentResult
            completeSpeechError("unavailable", error.message ?: "当前设备没有可用的系统语音识别")
        }
    }

    private fun startSpeechRecognitionActivity() {
        try {
            startActivityForResult(buildSpeechRecognitionIntent(), SPEECH_ACTIVITY_REQUEST)
        } catch (error: ActivityNotFoundException) {
            completeSpeechError("unavailable", NO_SYSTEM_ASR_MESSAGE)
        }
    }

    private fun handleSpeechActivityResult(resultCode: Int, data: Intent?) {
        if (speechRequestMode != SpeechRequestMode.ACTIVITY || speechResult == null) {
            return
        }
        if (resultCode != Activity.RESULT_OK) {
            completeSpeechError("no_match", "未识别到语音内容")
            return
        }
        val text = data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (text.isEmpty()) {
            completeSpeechError("no_match", "未识别到语音内容")
            return
        }
        completeSpeechSuccess(text)
    }

    private fun completeSpeechSuccess(text: String) {
        val result = speechResult ?: return
        cleanupSpeechRecognizer(destroyPendingResult = false)
        speechResult = null
        pendingLocale = null
        speechRequestMode = null
        result.success(text)
    }

    private fun completeSpeechError(code: String, message: String) {
        val result = speechResult ?: return
        cleanupSpeechRecognizer(destroyPendingResult = false)
        speechResult = null
        pendingLocale = null
        speechRequestMode = null
        result.error(code, message, null)
    }

    private fun cleanupSpeechRecognizer(destroyPendingResult: Boolean = true) {
        clearSpeechTimeouts()
        speechRecognizer?.destroy()
        speechRecognizer = null
        if (destroyPendingResult) {
            speechResult = null
            pendingLocale = null
            speechRequestMode = null
        }
    }

    private fun isSystemSpeechRecognitionAvailable(): Boolean {
        return SpeechRecognizer.isRecognitionAvailable(this) || isRecognitionActivityAvailable()
    }

    private fun isRecognitionActivityAvailable(): Boolean {
        return buildSpeechRecognitionIntent().resolveActivity(packageManager) != null
    }

    private fun buildSpeechRecognitionIntent(): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            applySpeechIntentExtras()
            putExtra(RecognizerIntent.EXTRA_PROMPT, "语音输入")
        }
    }

    private fun Intent.applySpeechIntentExtras() {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        pendingLocale?.takeIf { it.isNotBlank() }?.let {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, it)
        }
    }

    private fun scheduleSpeechTimeout() {
        speechTimeoutRunnable?.let { speechHandler.removeCallbacks(it) }
        speechTimeoutRunnable = Runnable {
            completeSpeechError("no_match", "未识别到语音内容")
        }.also { speechHandler.postDelayed(it, SPEECH_HARD_TIMEOUT_MS) }
    }

    private fun scheduleStopTimeout() {
        stopTimeoutRunnable?.let { speechHandler.removeCallbacks(it) }
        stopTimeoutRunnable = Runnable {
            completeSpeechError("no_match", "未识别到语音内容")
        }.also { speechHandler.postDelayed(it, SPEECH_STOP_TIMEOUT_MS) }
    }

    private fun clearSpeechTimeouts() {
        speechTimeoutRunnable?.let { speechHandler.removeCallbacks(it) }
        stopTimeoutRunnable?.let { speechHandler.removeCallbacks(it) }
        speechTimeoutRunnable = null
        stopTimeoutRunnable = null
    }

    private fun mapSpeechError(error: Int): Pair<String, String> {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "unavailable" to "录音失败"
            SpeechRecognizer.ERROR_CLIENT -> "unavailable" to "语音识别被中断"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission_denied" to "需要麦克风权限"
            SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
            SpeechRecognizer.ERROR_SERVER -> "network" to "系统语音识别服务暂时不可用"
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_match" to "未识别到语音内容"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy" to "正在识别上一段语音"
            else -> "unavailable" to "语音识别失败"
        }
    }

    companion object {
        private const val SPEECH_CHANNEL = "eco_mobile/system_speech_recognizer"
        private const val SPEECH_PERMISSION_REQUEST = 9017
        private const val SPEECH_ACTIVITY_REQUEST = 9018
        private const val SPEECH_STOP_TIMEOUT_MS = 2000L
        private const val SPEECH_HARD_TIMEOUT_MS = 60000L
        private const val NO_SYSTEM_ASR_MESSAGE =
            "当前设备没有向 App 开放标准系统语音识别；部分 OPPO/国内安卓只在输入法内提供语音输入，应用无法直接调用。"
    }

    private enum class SpeechRequestMode {
        SERVICE,
        ACTIVITY,
    }
}
