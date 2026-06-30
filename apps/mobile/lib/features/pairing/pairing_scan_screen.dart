import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../core/network/eco_center_client.dart';
import '../../core/theme/eco_icons.dart';
import '../../core/theme/eco_theme.dart';

class PairingScanScreen extends StatefulWidget {
  const PairingScanScreen({super.key});

  @override
  State<PairingScanScreen> createState() => _PairingScanScreenState();
}

class _PairingScanScreenState extends State<PairingScanScreen> {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
  );

  bool _handled = false;
  bool _torchOn = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    final barcodes = capture.barcodes;
    for (final barcode in barcodes) {
      final raw = barcode.rawValue;
      if (raw == null || raw.isEmpty) continue;
      _handled = true;
      final payload = parsePairingQrPayload(raw);
      Navigator.of(context).pop(payload);
      return;
    }
  }

  Future<void> _toggleTorch() async {
    await _controller.toggleTorch();
    if (!mounted) return;
    setState(() => _torchOn = !_torchOn);
  }

  @override
  Widget build(BuildContext context) {
    final eco = ecoColors(context);
    final scanSize = MediaQuery.sizeOf(context).width * 0.68;

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Colors.white,
        title: const Text('扫描配对码'),
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          IgnorePointer(
            child: CustomPaint(
              painter: _ScanOverlayPainter(
                scanSize: scanSize,
                accent: eco.accent,
              ),
            ),
          ),
          SafeArea(
            child: Column(
              children: [
                const Spacer(flex: 3),
                SizedBox(height: scanSize),
                const SizedBox(height: 28),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 40),
                  child: Text(
                    '将 Desktop「连接」页的二维码放入框内',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: Colors.white.withValues(alpha: 0.82),
                          height: 1.5,
                        ),
                  ),
                ),
                const Spacer(flex: 2),
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _ScanActionChip(
                        icon: _torchOn ? EcoIcons.flashlightOn : EcoIcons.flashlight,
                        label: _torchOn ? '关闭灯光' : '打开灯光',
                        onTap: _toggleTorch,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ScanActionChip extends StatelessWidget {
  const _ScanActionChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(24),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(24),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: Colors.white.withValues(alpha: 0.9)),
              const SizedBox(width: 8),
              Text(
                label,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: Colors.white.withValues(alpha: 0.9),
                      fontWeight: FontWeight.w500,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ScanOverlayPainter extends CustomPainter {
  const _ScanOverlayPainter({
    required this.scanSize,
    required this.accent,
  });

  final double scanSize;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height * 0.42);
    final rect = Rect.fromCenter(
      center: center,
      width: scanSize,
      height: scanSize,
    );
    final radius = const Radius.circular(18);

    final overlayPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final holePath = Path()
      ..addRRect(RRect.fromRectAndRadius(rect, radius));
    final maskPath = Path.combine(PathOperation.difference, overlayPath, holePath);

    canvas.drawPath(
      maskPath,
      Paint()..color = Colors.black.withValues(alpha: 0.55),
    );

    final cornerLength = 22.0;
    final cornerStroke = Paint()
      ..color = accent.withValues(alpha: 0.9)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    void drawCorner(Offset origin, {required bool top, required bool left}) {
      final dx = left ? 1.0 : -1.0;
      final dy = top ? 1.0 : -1.0;
      final start = origin;
      final horizontal = Offset(origin.dx + cornerLength * dx, origin.dy);
      final vertical = Offset(origin.dx, origin.dy + cornerLength * dy);
      canvas.drawLine(start, horizontal, cornerStroke);
      canvas.drawLine(start, vertical, cornerStroke);
    }

    drawCorner(rect.topLeft, top: true, left: true);
    drawCorner(rect.topRight, top: true, left: false);
    drawCorner(rect.bottomLeft, top: false, left: true);
    drawCorner(rect.bottomRight, top: false, left: false);
  }

  @override
  bool shouldRepaint(covariant _ScanOverlayPainter oldDelegate) {
    return oldDelegate.scanSize != scanSize || oldDelegate.accent != accent;
  }
}
