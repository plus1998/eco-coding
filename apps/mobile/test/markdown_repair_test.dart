import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/markdown_repair.dart';

void main() {
  test('splitTableRow drops delimiter pipes and keeps escaped pipes', () {
    expect(splitTableRow('Header1 | Header2 | '), ['Header1', 'Header2']);
    expect(splitTableRow(r'| a \| b | c |'), [r'a \| b', 'c']);
    expect(splitTableRow('| 1 | 2 | |'), ['1', '2', '']);
  });

  test('repairs inconsistent column counts without dropping extra cells', () {
    const input = 'Header1 | Header2 | \n|---|---|\nValue1  | Value2 | Value3';
    expect(
      repairMarkdown(input),
      '| Header1 | Header2 |  |\n| --- | --- | --- |\n| Value1 | Value2 | Value3 |',
    );
  });

  test('pads a short separator so the table can parse', () {
    const input = '| x | y | z |\n| --- | --- |\n| 1 | 2 |';
    expect(
      repairMarkdown(input),
      '| x | y | z |\n| --- | --- | --- |\n| 1 | 2 |  |',
    );
  });

  test('preserves alignment markers when widening the separator', () {
    const input = '| a | b | c |\n| :--- | ---: |\n| 1 | 2 | 3 |';
    expect(
      repairMarkdown(input),
      '| a | b | c |\n| :--- | ---: | --- |\n| 1 | 2 | 3 |',
    );
  });

  test('leaves a consistent table byte-identical', () {
    const compact = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(repairMarkdown(compact), compact);
  });

  test('splitEcoMarkdownSegments isolates GFM tables from prose', () {
    const input = 'intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\noutro';
    final segments = splitEcoMarkdownSegments(input);
    expect(segments, hasLength(3));
    expect(segments[0], isA<EcoMarkdownProseSegment>());
    expect((segments[0] as EcoMarkdownProseSegment).text, contains('intro'));
    expect(segments[1], isA<EcoMarkdownTableSegment>());
    final table = (segments[1] as EcoMarkdownTableSegment).table;
    expect(table.header, ['a', 'b']);
    expect(table.rows, [
      ['1', '2'],
    ]);
    expect(segments[2], isA<EcoMarkdownProseSegment>());
    expect((segments[2] as EcoMarkdownProseSegment).text, contains('outro'));
  });

  test('splitEcoMarkdownSegments skips fenced table examples', () {
    const input = '```md\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n';
    final segments = splitEcoMarkdownSegments(input);
    expect(segments, hasLength(1));
    expect(segments.single, isA<EcoMarkdownProseSegment>());
  });

  test('rewrites the no-leading-pipe case when a body row is wider', () {
    const input =
        ' Header1 | Header2 | \n |---|---|\n  Value1  | Value2 | Value3';
    expect(
      repairMarkdown(input),
      '| Header1 | Header2 |  |\n| --- | --- | --- |\n| Value1 | Value2 | Value3 |',
    );
  });

  test('does not rewrite fenced table examples', () {
    const input = '```\n| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n```';
    expect(repairMarkdown(input), input);
  });

  test('does not invent a separator when it is missing', () {
    const input = '| Header1 | Header2 | Header3\nValue1 | Value3';
    expect(repairMarkdown(input), input);
  });

  test('repairs only the broken table in a mixed document', () {
    const input =
        'intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| x | y |\n| --- | --- |\n| 1 | 2 | 3 |\n\noutro';
    expect(
      repairMarkdown(input),
      'intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| x | y |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n\noutro',
    );
  });

  test('table repair pipeline accepts additional fixers', () {
    final shoutHeader = MarkdownTableFixer(
      id: 'shout-header',
      apply: (table) => MarkdownTable(
        header: [for (final cell in table.header) cell.toUpperCase()],
        separator: table.separator,
        rows: table.rows,
      ),
    );
    final repair = createMarkdownTableRepair(
      detectors: [gfmHeaderSeparatorDetector],
      fixers: [normalizeColumnCountFixer, shoutHeader],
    );
    const input = '| a | b |\n| --- | --- |\n| 1 | 2 | 3 |';
    expect(
      repair.apply(input),
      '| A | B |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |',
    );
  });
}
