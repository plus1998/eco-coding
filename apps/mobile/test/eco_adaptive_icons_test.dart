import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/theme/eco_adaptive_icons.dart';
import 'package:eco_mobile/core/theme/eco_icons.dart';

void main() {
  test('maps the plan menu icon to an SF Symbol', () {
    expect(ecoIconSfSymbol(EcoIcons.planApproval), 'checklist');
  });
}
