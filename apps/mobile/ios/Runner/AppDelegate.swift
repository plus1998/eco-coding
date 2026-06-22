import AVFoundation
import Flutter
import Speech
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let systemSpeechRecognizer = SystemSpeechRecognizer()

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController {
      let channel = FlutterMethodChannel(
        name: "eco_mobile/system_speech_recognizer",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        self?.systemSpeechRecognizer.handle(call: call, result: result)
      }
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

private final class SystemSpeechRecognizer: NSObject {
  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var pendingResult: FlutterResult?
  private var currentTranscript = ""
  private var inputTapInstalled = false
  private var silenceTimer: Timer?
  private var hardTimeoutTimer: Timer?

  func handle(call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isAvailable":
      result(resolveRecognizer(call: call)?.isAvailable == true)
    case "recognize":
      recognize(call: call, result: result)
    case "stop":
      finishRecognition()
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func recognize(call: FlutterMethodCall, result: @escaping FlutterResult) {
    guard pendingResult == nil else {
      result(FlutterError(code: "busy", message: "正在识别上一段语音", details: nil))
      return
    }
    guard let recognizer = resolveRecognizer(call: call), recognizer.isAvailable else {
      result(FlutterError(code: "unavailable", message: "当前设备没有可用的系统语音识别", details: nil))
      return
    }
    pendingResult = result
    currentTranscript = ""
    requestAuthorization { [weak self] authorized in
      guard let self else { return }
      guard authorized else {
        self.completeError(code: "permission_denied", message: "需要麦克风与语音识别权限")
        return
      }
      guard self.pendingResult != nil else { return }
      self.startRecognition(recognizer: recognizer)
    }
  }

  private func resolveRecognizer(call: FlutterMethodCall) -> SFSpeechRecognizer? {
    let args = call.arguments as? [String: Any]
    let localeId = (args?["locale"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let localeId, !localeId.isEmpty {
      return SFSpeechRecognizer(locale: Locale(identifier: localeId))
    }
    return SFSpeechRecognizer()
  }

  private func requestAuthorization(_ completion: @escaping (Bool) -> Void) {
    SFSpeechRecognizer.requestAuthorization { speechStatus in
      guard speechStatus == .authorized else {
        DispatchQueue.main.async { completion(false) }
        return
      }
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        DispatchQueue.main.async { completion(granted) }
      }
    }
  }

  private func startRecognition(recognizer: SFSpeechRecognizer) {
    guard pendingResult != nil else { return }
    cleanupRecognition(keepPendingResult: true)

    let audioEngine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    self.audioEngine = audioEngine
    recognitionRequest = request

    let audioSession = AVAudioSession.sharedInstance()
    do {
      try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
      try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    } catch {
      completeError(code: "unavailable", message: "无法启动麦克风")
      return
    }

    let inputNode = audioEngine.inputNode
    let format = inputNode.outputFormat(forBus: 0)
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
      request?.append(buffer)
    }
    inputTapInstalled = true

    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self, self.pendingResult != nil else { return }
      if let result {
        self.currentTranscript = result.bestTranscription.formattedString
        if result.isFinal {
          self.completeSuccess(text: self.currentTranscript)
          return
        }
        if !self.currentTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          self.scheduleSilenceFinish()
        }
      }
      if let error {
        self.completeError(code: "unavailable", message: error.localizedDescription)
      }
    }

    audioEngine.prepare()
    do {
      try audioEngine.start()
      scheduleHardTimeout()
    } catch {
      completeError(code: "unavailable", message: "无法启动麦克风")
    }
  }

  private func scheduleSilenceFinish() {
    silenceTimer?.invalidate()
    silenceTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
      self?.finishRecognition()
    }
  }

  private func scheduleHardTimeout() {
    hardTimeoutTimer?.invalidate()
    hardTimeoutTimer = Timer.scheduledTimer(withTimeInterval: 60.0, repeats: false) { [weak self] _ in
      self?.finishRecognition()
    }
  }

  private func finishRecognition() {
    guard pendingResult != nil else {
      cleanupRecognition(keepPendingResult: false)
      return
    }
    let transcript = currentTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
    if transcript.isEmpty {
      completeError(code: "no_match", message: "未识别到语音内容")
      return
    }
    completeSuccess(text: transcript)
  }

  private func completeSuccess(text: String) {
    guard let result = pendingResult else { return }
    pendingResult = nil
    cleanupRecognition(keepPendingResult: true)
    currentTranscript = ""
    result(text.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private func completeError(code: String, message: String) {
    guard let result = pendingResult else { return }
    pendingResult = nil
    cleanupRecognition(keepPendingResult: true)
    currentTranscript = ""
    result(FlutterError(code: code, message: message, details: nil))
  }

  private func cleanupRecognition(keepPendingResult: Bool) {
    silenceTimer?.invalidate()
    hardTimeoutTimer?.invalidate()
    silenceTimer = nil
    hardTimeoutTimer = nil

    recognitionRequest?.endAudio()
    recognitionTask?.cancel()
    recognitionTask = nil
    recognitionRequest = nil

    if let audioEngine {
      if inputTapInstalled {
        audioEngine.inputNode.removeTap(onBus: 0)
      }
      audioEngine.stop()
    }
    inputTapInstalled = false
    audioEngine = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

    if !keepPendingResult {
      pendingResult = nil
      currentTranscript = ""
    }
  }
}
