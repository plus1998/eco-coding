import 'package:eco_mobile/core/widgets/eco_model_cascade.dart';
import 'package:eco_mobile/l10n/generated/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  List<ModelCascadeEntry> entries(int count) => [
    for (var i = 0; i < count; i++)
      ModelCascadeEntry(
        key: 'model-$i',
        providerKey: 'openai',
        providerName: 'OpenAI',
        modelId: 'gpt-mini-$i',
        title: 'Model $i',
      ),
  ];

  Widget app(Widget child) => MaterialApp(
    locale: const Locale('en'),
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: Scaffold(body: Align(alignment: Alignment.topLeft, child: child)),
  );

  Widget host({
    required double height,
    int optionCount = 12,
    bool flexibleBody = true,
  }) {
    return app(
      SizedBox(
        width: 320,
        height: height,
        child: EcoModelCascadeList(
          layout: EcoModelCascadeLayout.split,
          height: 280,
          flexibleBody: flexibleBody,
          options: entries(optionCount),
        ),
      ),
    );
  }

  /// The split catalogue's columns are the only vertical scrollables here, so
  /// their rect *is* the body geometry (the cascade widget itself is stretched
  /// by its parent box and would say nothing about overflow).
  List<Rect> bodyRects(WidgetTester tester) => [
    for (final element in find.byType(ListView).evaluate())
      tester.getRect(find.byWidget(element.widget)),
  ];

  testWidgets('flexibleBody keeps the preferred 280 catalogue body', (
    tester,
  ) async {
    await tester.pumpWidget(host(height: 600));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final bodies = bodyRects(tester);
    expect(bodies, isNotEmpty);
    for (final body in bodies) {
      expect(body.height, 280);
    }
  });

  testWidgets('flexibleBody shrinks the catalogue instead of overflowing', (
    tester,
  ) async {
    await tester.pumpWidget(host(height: 600));
    await tester.pumpAndSettle();
    final contentHeight = bodyRects(tester).first.bottom;
    expect(contentHeight, greaterThan(280)); // chrome sits above the body

    const shaved = 60.0;
    await tester.pumpWidget(host(height: contentHeight - shaved));
    await tester.pumpAndSettle();

    // A layout overflow surfaces here as a thrown FlutterError.
    expect(tester.takeException(), isNull);
    final bodies = bodyRects(tester);
    expect(bodies, isNotEmpty);
    for (final body in bodies) {
      expect(body.bottom, lessThanOrEqualTo(contentHeight - shaved));
      expect(body.height, 280 - shaved);
    }
  });

  testWidgets('flexibleBody keeps the search box and rows when space is tight', (
    tester,
  ) async {
    // Enough for the chrome plus a sliver of catalogue, and nothing else.
    const box = 130.0;
    await tester.pumpWidget(host(height: box, optionCount: 4));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(TextField), findsOneWidget);
    for (final body in bodyRects(tester)) {
      expect(body.bottom, lessThanOrEqualTo(box));
    }
  });

  testWidgets('without flexibleBody the body still demands its height', (
    tester,
  ) async {
    await tester.pumpWidget(host(height: 500, flexibleBody: false));
    await tester.pumpAndSettle();

    // Documented contract for the sheet/list callers: the caller supplies the
    // room, the body keeps the full 280.
    expect(tester.takeException(), isNull);
    final bodies = bodyRects(tester);
    expect(bodies, isNotEmpty);
    for (final body in bodies) {
      expect(body.height, 280);
    }
  });
}
