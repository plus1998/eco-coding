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
      if let registrar = registrar(forPlugin: "EcoMobileLiquidGlassActionButton") {
        registrar.register(
          EcoMobileLiquidGlassActionButtonFactory(
            messenger: controller.binaryMessenger
          ),
          withId: "eco_mobile/liquid_glass_action_button"
        )
      }
      let channel = FlutterMethodChannel(
        name: "eco_mobile/system_speech_recognizer",
        binaryMessenger: controller.binaryMessenger
      )
      channel.setMethodCallHandler { [weak self] call, result in
        self?.systemSpeechRecognizer.handle(call: call, result: result)
      }
      let levelChannel = FlutterEventChannel(
        name: "eco_mobile/system_speech_recognizer_levels",
        binaryMessenger: controller.binaryMessenger
      )
      levelChannel.setStreamHandler(systemSpeechRecognizer)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

private final class EcoMobileLiquidGlassActionButtonFactory: NSObject,
  FlutterPlatformViewFactory {
  private let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    EcoMobileLiquidGlassActionButton(
      frame: frame,
      viewIdentifier: viewId,
      arguments: args,
      binaryMessenger: messenger
    )
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

private final class EcoMobileLiquidGlassActionButton: NSObject,
  FlutterPlatformView {
  private let container: UIView
  private let button: UIButton
  private let channel: FlutterMethodChannel
  private let label: String
  private let sfSymbol: String
  private var foregroundColor: UIColor
  private var isEnabled: Bool
  private var isDark: Bool

  init(
    frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?,
    binaryMessenger messenger: FlutterBinaryMessenger
  ) {
    container = UIView(frame: frame)
    button = UIButton(type: .system)
    let config = args as? [String: Any] ?? [:]
    label = config["label"] as? String ?? ""
    sfSymbol = config["sfSymbol"] as? String ?? "circle"
    foregroundColor = UIColor(argb: config["foregroundColor"] as? Int ?? 0xFF1D1D1F)
    isEnabled = config["enabled"] as? Bool ?? true
    isDark = config["isDark"] as? Bool ?? false
    channel = FlutterMethodChannel(
      name: "eco_mobile/liquid_glass_action_button_\(config["id"] as? Int ?? Int(viewId))",
      binaryMessenger: messenger
    )

    super.init()
    configureView()
  }

  func view() -> UIView {
    container
  }

  private func configureView() {
    container.overrideUserInterfaceStyle = isDark ? .dark : .light
    button.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(button)
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      button.topAnchor.constraint(equalTo: container.topAnchor),
      button.bottomAnchor.constraint(equalTo: container.bottomAnchor),
    ])
    button.addTarget(self, action: #selector(buttonTapped), for: .touchUpInside)
    button.isEnabled = isEnabled
    applyConfiguration()
    channel.setMethodCallHandler { [weak self] call, result in
      self?.handle(call, result: result)
    }
  }

  private func applyConfiguration() {
    if #available(iOS 26.0, *) {
      var configuration = UIButton.Configuration.glass()
      configuration.cornerStyle = .capsule
      configuration.image = UIImage(
        systemName: sfSymbol,
        withConfiguration: UIImage.SymbolConfiguration(
          pointSize: 22,
          weight: .semibold
        )
      )
      configuration.title = label
      configuration.imagePlacement = .top
      configuration.imagePadding = 3
      configuration.contentInsets = NSDirectionalEdgeInsets(
        top: 6,
        leading: 12,
        bottom: 6,
        trailing: 12
      )
      var attributedTitle = AttributedString(label)
      attributedTitle.font = .systemFont(ofSize: 11, weight: .semibold)
      configuration.attributedTitle = attributedTitle
      configuration.baseForegroundColor = foregroundColor
      button.configuration = configuration
    } else {
      var configuration = UIButton.Configuration.tinted()
      configuration.cornerStyle = .capsule
      configuration.image = UIImage(systemName: sfSymbol)
      configuration.title = label
      configuration.imagePlacement = .top
      configuration.imagePadding = 3
      configuration.baseForegroundColor = foregroundColor
      button.configuration = configuration
    }
    button.isEnabled = isEnabled
  }

  @objc private func buttonTapped() {
    channel.invokeMethod("pressed", arguments: nil)
    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "setEnabled":
      if let args = call.arguments as? [String: Any],
        let enabled = args["enabled"] as? Bool
      {
        isEnabled = enabled
        button.isEnabled = enabled
      }
      result(nil)
    case "setColor":
      if let args = call.arguments as? [String: Any],
        let color = args["color"] as? Int
      {
        foregroundColor = UIColor(argb: color)
        applyConfiguration()
      }
      result(nil)
    case "setBrightness":
      if let args = call.arguments as? [String: Any],
        let dark = args["isDark"] as? Bool
      {
        isDark = dark
        container.overrideUserInterfaceStyle = dark ? .dark : .light
      }
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

private extension UIColor {
  convenience init(argb: Int) {
    self.init(
      red: CGFloat((argb >> 16) & 0xFF) / 255,
      green: CGFloat((argb >> 8) & 0xFF) / 255,
      blue: CGFloat(argb & 0xFF) / 255,
      alpha: CGFloat((argb >> 24) & 0xFF) / 255
    )
  }
}

private final class SystemSpeechRecognizer: NSObject, FlutterStreamHandler {
  private var audioEngine: AVAudioEngine?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var pendingResult: FlutterResult?
  private var currentTranscript = ""
  private var inputTapInstalled = false
  private var silenceTimer: Timer?
  private var hardTimeoutTimer: Timer?
  private var levelSink: FlutterEventSink?

  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    levelSink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    levelSink = nil
    return nil
  }

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
    inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) {
      [weak self, weak request] buffer, _ in
      request?.append(buffer)
      self?.publishAudioLevel(buffer)
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

  private func publishAudioLevel(_ buffer: AVAudioPCMBuffer) {
    guard let samples = buffer.floatChannelData?[0] else { return }
    let frameCount = Int(buffer.frameLength)
    guard frameCount > 0 else { return }

    var sum: Float = 0
    for index in 0..<frameCount {
      let sample = samples[index]
      sum += sample * sample
    }
    let rms = sqrt(sum / Float(frameCount))
    let decibels = 20 * log10(max(rms, 0.000_001))
    let normalized = Double(min(max((decibels + 55) / 50, 0), 1))
    DispatchQueue.main.async { [weak self] in
      self?.levelSink?(normalized)
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
