import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/models/git_models.dart';
import 'package:eco_mobile/core/utils/unified_diff.dart';

const sampleDiff = '''diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line
+added
-old
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-removed
+kept
''';

void main() {
  test('parseUnifiedDiff extracts per-file hunks and lines', () {
    final files = parseUnifiedDiff(sampleDiff);
    expect(files.length, 2);
    expect(files.first.path, 'src/a.ts');
    expect(files.first.hunks.length, 1);
    expect(files.first.hunks.first.rangeLabel, '第 1-4 行');
    expect(files.first.additions, 1);
    expect(files.first.deletions, 1);
    expect(
      files.first.hunks.first.lines.any(
        (line) => line.kind == DiffLineKind.addition && line.content == 'added',
      ),
      isTrue,
    );
  });

  test('mergeDiffFilesWithStats keeps files without hunks when patch missing', () {
    final merged = mergeDiffFilesWithStats(
      patch: '',
      files: const [
        WorkspaceDiffFile(path: 'src/a.ts', additions: 1, deletions: 0),
      ],
    );
    expect(merged.length, 1);
    expect(merged.first.path, 'src/a.ts');
    expect(merged.first.hunks, isEmpty);
  });
}
