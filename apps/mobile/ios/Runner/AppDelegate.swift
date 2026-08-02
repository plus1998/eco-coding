import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    if let controller = window?.rootViewController as? FlutterViewController,
      let registrar = registrar(forPlugin: "EcoMobileLiquidGlassActionButton")
    {
      registrar.register(
        EcoMobileLiquidGlassActionButtonFactory(
          messenger: controller.binaryMessenger
        ),
        withId: "eco_mobile/liquid_glass_action_button"
      )
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

  func view() -> UIView { container }

  private func configureView() {
    container.overrideUserInterfaceStyle = isDark ? .dark : .light
    button.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(button)
    // Center vertically instead of pinning top+bottom: Flutter may size the
    // platform view taller than UIButton's intrinsic height (~44), and filling
    // both axes fights that constraint.
    NSLayoutConstraint.activate([
      button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
      button.centerYAnchor.constraint(equalTo: container.centerYAnchor),
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
        withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
      )
      configuration.title = label
      configuration.imagePlacement = .top
      configuration.imagePadding = 3
      configuration.contentInsets = NSDirectionalEdgeInsets(
        top: 6, leading: 12, bottom: 6, trailing: 12
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
