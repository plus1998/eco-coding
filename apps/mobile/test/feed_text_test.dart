import 'package:flutter_test/flutter_test.dart';

import 'package:eco_mobile/core/utils/feed_text.dart';

void expectPartition(
  StreamingMarkdownPartition actual, {
  required String stable,
  required String tail,
}) {
  expect(actual.stable, stable);
  expect(actual.tail, tail);
}

void main() {
  test('removes internal web citation tokens', () {
    expect(
      sanitizeFeedText('模型输出。 citeturn0search0turn0search3'),
      '模型输出。 ',
    );
  });

  test('non-streaming Markdown stays entirely stable', () {
    expectPartition(
      partitionStreamingMarkdown('hello\n\nworld', streaming: false),
      stable: 'hello\n\nworld',
      tail: '',
    );
  });

  test('unfinished prose is kept as a live Markdown tail', () {
    final partition = partitionStreamingMarkdown('正在分析项目结构', streaming: true);
    expect(partition.stable, isEmpty);
    expect(partition.tail, '正在分析项目结构');
    expect(isStructuralStreamingTail(partition.tail), isFalse);
  });

  test('completed paragraph is stable before unfinished prose', () {
    expectPartition(
      partitionStreamingMarkdown('done para\n\nworking', streaming: true),
      stable: 'done para\n\n',
      tail: 'working',
    );
  });

  test('incomplete code fence stays structural', () {
    const source = 'intro\n```bash\necho hi';
    expectPartition(
      partitionStreamingMarkdown(source, streaming: true),
      stable: 'intro\n',
      tail: '```bash\necho hi',
    );
    expect(isStructuralStreamingTail('```bash\necho hi'), isTrue);
  });

  test('completed code fence commits before unfinished prose', () {
    expectPartition(
      partitionStreamingMarkdown(
        'intro\n```bash\necho hi\n```\nnext',
        streaming: true,
      ),
      stable: 'intro\n```bash\necho hi\n```\n',
      tail: 'next',
    );
  });

  test('incomplete GFM table with separator stays structural', () {
    const source = '| a | b |\n| --- | --- |\n| 1 |';
    expectPartition(
      partitionStreamingMarkdown(source, streaming: true),
      stable: '',
      tail: source,
    );
    expect(isStructuralStreamingTail(source), isTrue);
  });

  test('pipe rows without separator are not structural', () {
    expect(isStructuralStreamingTail('| a | b |\n| c | d |'), isFalse);
    expect(isStructuralStreamingTail('| a | b |\n| ---'), isFalse);
  });

  test('malformed pipe rows then prose do not freeze the tail as plain', () {
    expectPartition(
      partitionStreamingMarkdown(
        '| a | b |\n| c | d |\n\nmore text',
        streaming: true,
      ),
      stable: '| a | b |\n| c | d |\n\n',
      tail: 'more text',
    );
    expect(isStructuralStreamingTail('more text'), isFalse);
  });

  test('malformed pipe rows ending on prose commit before the prose line', () {
    expectPartition(
      partitionStreamingMarkdown(
        '| a | b |\n| c | d |\nmore text',
        streaming: true,
      ),
      stable: '| a | b |\n| c | d |\n',
      tail: 'more text',
    );
    expect(isStructuralStreamingTail('more text'), isFalse);
  });

  test('completed table commits before unfinished prose', () {
    expectPartition(
      partitionStreamingMarkdown(
        '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nmore',
        streaming: true,
      ),
      stable: '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n',
      tail: 'more',
    );
  });

  test('unfinished search-replace block stays structural', () {
    expectPartition(
      partitionStreamingMarkdown(
        'before\n<<<<<<< SEARCH\nold',
        streaming: true,
      ),
      stable: 'before\n',
      tail: '<<<<<<< SEARCH\nold',
    );
    expect(isStructuralStreamingTail('<<<<<<< SEARCH\nold'), isTrue);
  });
}
