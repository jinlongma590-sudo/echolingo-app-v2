package cn.echolingo.appv2

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class PcmCaptureModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {
  companion object {
    private const val TAG = "PcmCaptureModule"
    private const val DEFAULT_SAMPLE_RATE = 24000
    private const val DEFAULT_CHANNELS = 1
    private const val DEFAULT_CHUNK_MS = 40
    private const val BYTES_PER_SAMPLE = 2
  }

  private val isCapturing = AtomicBoolean(false)
  private var audioRecord: AudioRecord? = null
  private var captureThread: Thread? = null
  private var listenerCount = 0

  private var targetSampleRate = DEFAULT_SAMPLE_RATE
  private var targetChannels = DEFAULT_CHANNELS
  private var chunkMs = DEFAULT_CHUNK_MS
  private var chunkByteLength = DEFAULT_SAMPLE_RATE * DEFAULT_CHANNELS * BYTES_PER_SAMPLE * DEFAULT_CHUNK_MS / 1000
  private var capturedBytes = 0L
  private var chunksEmitted = 0L
  private var sequence = 0L
  private var startedAtMs = 0L
  private var lastStatsAtMs = 0L

  init {
    Log.i(TAG, "Android PcmCaptureModule registered / supported")
    reactContext.addLifecycleEventListener(this)
  }

  override fun getName(): String = "PcmCaptureModule"

  override fun getConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "supported" to true,
      "platform" to "android"
    )

  @ReactMethod
  fun isSupported(promise: Promise) {
    Log.i(TAG, "pcm_capture_supported supported=true platform=android")
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("supported", true)
        putString("platform", "android")
      }
    )
  }

  @ReactMethod
  fun start(input: ReadableMap?, promise: Promise) {
    val sampleRate = input?.getIntOrDefault("sampleRate", DEFAULT_SAMPLE_RATE) ?: DEFAULT_SAMPLE_RATE
    val channels = input?.getIntOrDefault("channels", DEFAULT_CHANNELS) ?: DEFAULT_CHANNELS
    val requestedChunkMs = input?.getIntOrDefault("chunkMs", DEFAULT_CHUNK_MS) ?: DEFAULT_CHUNK_MS

    if (sampleRate <= 0 || channels <= 0 || requestedChunkMs <= 0) {
      promise.resolve(startResult(false, max(sampleRate, DEFAULT_SAMPLE_RATE), max(channels, DEFAULT_CHANNELS), max(requestedChunkMs, DEFAULT_CHUNK_MS), "invalid_capture_config"))
      return
    }

    if (ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.resolve(startResult(false, sampleRate, channels, requestedChunkMs, "microphone_permission_denied"))
      return
    }

    stopCapture()

    val channelConfig = AudioFormat.CHANNEL_IN_MONO
    val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    val requestedChunkBytes = sampleRate * channels * BYTES_PER_SAMPLE * requestedChunkMs / 1000
    val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
    if (minBufferSize == AudioRecord.ERROR || minBufferSize == AudioRecord.ERROR_BAD_VALUE) {
      promise.resolve(startResult(false, sampleRate, channels, requestedChunkMs, "audio_record_min_buffer_unavailable"))
      return
    }

    val bufferSize = max(minBufferSize, requestedChunkBytes * 4)
    val record = createAudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, sampleRate, channelConfig, audioFormat, bufferSize)
      ?: createAudioRecord(MediaRecorder.AudioSource.MIC, sampleRate, channelConfig, audioFormat, bufferSize)

    if (record == null) {
      promise.resolve(startResult(false, sampleRate, channels, requestedChunkMs, "audio_record_unavailable"))
      return
    }

    targetSampleRate = sampleRate
    targetChannels = channels
    chunkMs = requestedChunkMs
    chunkByteLength = requestedChunkBytes
    capturedBytes = 0L
    chunksEmitted = 0L
    sequence = 0L
    startedAtMs = SystemClock.elapsedRealtime()
    lastStatsAtMs = startedAtMs
    audioRecord = record
    isCapturing.set(true)

    try {
      record.startRecording()
    } catch (error: IllegalStateException) {
      isCapturing.set(false)
      audioRecord = null
      record.release()
      promise.resolve(startResult(false, sampleRate, channels, requestedChunkMs, "audio_record_start_failed"))
      return
    }

    captureThread = Thread({ captureLoop(record) }, "PcmCaptureThread").apply {
      isDaemon = true
      start()
    }

    Log.i(TAG, "pcm_capture_started sampleRate=$sampleRate channels=$channels chunkMs=$requestedChunkMs format=pcm16")
    promise.resolve(startResult(true, sampleRate, channels, requestedChunkMs, null))
  }

  @ReactMethod
  fun stop(promise: Promise) {
    val previousSampleRate = targetSampleRate
    val previousChannels = targetChannels
    val previousChunkMs = chunkMs
    stopCapture()

    val durationMs = if (previousSampleRate > 0 && previousChannels > 0) {
      ((capturedBytes.toDouble() / (previousSampleRate.toDouble() * previousChannels.toDouble() * BYTES_PER_SAMPLE.toDouble())) * 1000.0).toInt()
    } else {
      0
    }

    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("ok", capturedBytes > 0)
        putDouble("capturedBytes", capturedBytes.toDouble())
        putInt("sampleRate", previousSampleRate)
        putInt("channels", previousChannels)
        putInt("chunkMs", previousChunkMs)
        putString("format", "pcm16")
        putInt("durationMs", durationMs)
        if (capturedBytes <= 0) {
          putString("reason", "empty_capture")
        }
      }
    )
  }

  @ReactMethod
  fun ensureCaptureActiveAfterPlayback(promise: Promise) {
    promise.resolve(
      Arguments.createMap().apply {
        putBoolean("ok", isCapturing.get() && audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        putBoolean("restarted", false)
        putString("reason", if (isCapturing.get()) "capture_active" else "capture_inactive")
        putBoolean("engineRunning", audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING)
        putBoolean("isCapturing", isCapturing.get())
      }
    )
  }

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = max(0, listenerCount - count)
  }

  override fun invalidate() {
    reactContext.removeLifecycleEventListener(this)
    stopCapture()
    super.invalidate()
  }

  override fun onHostResume() = Unit

  override fun onHostPause() {
    stopCapture()
  }

  override fun onHostDestroy() {
    stopCapture()
  }

  private fun createAudioRecord(source: Int, sampleRate: Int, channelConfig: Int, audioFormat: Int, bufferSize: Int): AudioRecord? {
    return try {
      val record = AudioRecord(source, sampleRate, channelConfig, audioFormat, bufferSize)
      if (record.state == AudioRecord.STATE_INITIALIZED) {
        record
      } else {
        record.release()
        null
      }
    } catch (error: SecurityException) {
      Log.w(TAG, "audio_record_permission_error", error)
      null
    } catch (error: IllegalArgumentException) {
      Log.w(TAG, "audio_record_create_failed", error)
      null
    }
  }

  private fun captureLoop(record: AudioRecord) {
    val readBuffer = ByteArray(max(chunkByteLength, 1024))
    val pending = ArrayList<Byte>(chunkByteLength * 2)

    try {
      while (isCapturing.get()) {
        val read = record.read(readBuffer, 0, readBuffer.size)
        if (read <= 0) {
          continue
        }

        capturedBytes += read.toLong()
        for (index in 0 until read) {
          pending.add(readBuffer[index])
        }

        while (pending.size >= chunkByteLength && chunkByteLength > 0) {
          val chunk = ByteArray(chunkByteLength)
          for (index in 0 until chunkByteLength) {
            chunk[index] = pending[index]
          }
          pending.subList(0, chunkByteLength).clear()
          emitChunk(chunk)
        }

        emitStatsIfNeeded()
      }
    } catch (error: IllegalStateException) {
      Log.w(TAG, "pcm_capture_read_failed", error)
    } finally {
      try {
        if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
          record.stop()
        }
      } catch (error: IllegalStateException) {
        Log.w(TAG, "pcm_capture_stop_failed", error)
      }
    }
  }

  private fun emitChunk(chunk: ByteArray) {
    sequence += 1
    chunksEmitted += 1
    val payload = Arguments.createMap().apply {
      putDouble("sequence", sequence.toDouble())
      putInt("sampleRate", targetSampleRate)
      putInt("channels", targetChannels)
      putInt("chunkMs", chunkMs)
      putInt("bytes", chunk.size)
      putString("pcmBase64", Base64.encodeToString(chunk, Base64.NO_WRAP))
    }
    sendEvent("pcmChunk", payload)
  }

  private fun emitStatsIfNeeded() {
    val nowMs = SystemClock.elapsedRealtime()
    if (nowMs - lastStatsAtMs < 1000L) {
      return
    }
    lastStatsAtMs = nowMs
    val payload = Arguments.createMap().apply {
      putInt("elapsedMs", (nowMs - startedAtMs).toInt())
      putDouble("chunksEmitted", chunksEmitted.toDouble())
      putDouble("bytesEmitted", (chunksEmitted * chunkByteLength).toDouble())
      putInt("sampleRate", targetSampleRate)
      putInt("channels", targetChannels)
      putInt("chunkMs", chunkMs)
    }
    sendEvent("captureStats", payload)
  }

  private fun sendEvent(eventName: String, payload: com.facebook.react.bridge.WritableMap) {
    if (listenerCount <= 0 || !reactContext.hasActiveReactInstance()) {
      return
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(eventName, payload)
  }

  private fun stopCapture() {
    isCapturing.set(false)
    captureThread?.join(500)
    captureThread = null
    audioRecord?.release()
    audioRecord = null
  }

  private fun startResult(ok: Boolean, sampleRate: Int, channels: Int, chunkMs: Int, reason: String?) =
    Arguments.createMap().apply {
      putBoolean("ok", ok)
      putInt("sampleRate", sampleRate)
      putInt("channels", channels)
      putInt("chunkMs", chunkMs)
      putString("format", "pcm16")
      if (reason != null) {
        putString("reason", reason)
      }
    }

  private fun ReadableMap.getIntOrDefault(key: String, defaultValue: Int): Int {
    return if (hasKey(key) && !isNull(key)) getInt(key) else defaultValue
  }
}
