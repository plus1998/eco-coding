import 'package:eco_mobile/core/models/eco_types.dart';
import 'package:eco_mobile/core/utils/device_display.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('formatDeviceLabel', () {
    test('uses mobile model before generic name', () {
      expect(
        formatMobileLabel(
          const PublicDevice(
            id: 'dev_mobile',
            userId: 'usr_1',
            kind: 'mobile',
            name: 'Eco Mobile',
            createdAt: '2026-01-01T00:00:00.000Z',
            metadata: PublicDeviceMetadata(
              model: 'OPPO PJA110',
              ipAddress: '192.168.1.20',
            ),
          ),
          'dev_mobile',
        ),
        'OPPO PJA110',
      );
    });

    test('uses desktop hostname before device id', () {
      expect(
        formatDesktopLabel(
          const PublicDevice(
            id: 'dev_desktop',
            userId: 'usr_1',
            kind: 'desktop',
            name: 'Eco Desktop',
            createdAt: '2026-01-01T00:00:00.000Z',
            metadata: PublicDeviceMetadata(hostname: 'HappyPlusMac'),
          ),
          'dev_desktop',
        ),
        'HappyPlusMac',
      );
    });

    test('falls back to shortened device id', () {
      expect(formatDesktopLabel(null, 'dev_1234567890abcdef'), 'dev_1234…cdef');
    });
  });

  group('formatDeviceDetail', () {
    test('includes ip and platform without device id', () {
      expect(
        formatDeviceDetail(
          const PublicDevice(
            id: 'dev_desktop_2',
            userId: 'usr_1',
            kind: 'desktop',
            name: 'Eco Desktop',
            createdAt: '2026-01-01T00:00:00.000Z',
            metadata: PublicDeviceMetadata(
              ipAddress: '192.168.1.10',
              platform: 'darwin 25.5.0',
            ),
          ),
        ),
        '192.168.1.10 · darwin 25.5.0',
      );
    });
  });
}
