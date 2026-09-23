#!/usr/bin/env python3
"""Compare the mobile cross-end dump with the desktop golden, field by field.

Usage:
  ECO_CROSS_END_DUMP=1 flutter test test/conversation_v2_cross_end_golden_test.dart \
    | sed -n '/^=== /,$p' > /tmp/mobile-dump.txt
  python3 scripts/compare-cross-end-dump.py /tmp/mobile-dump.txt ../desktop/test/fixtures/feed-parity/v2-render
"""
import json
import pathlib
import sys

dump_path = pathlib.Path(sys.argv[1])
golden_dir = pathlib.Path(sys.argv[2])

text = dump_path.read_text()
sections = {}
for chunk in text.split("=== ")[1:]:
    name, _, body = chunk.partition("\n")
    # The dump is interleaved with test-runner progress lines; keep the JSON object only.
    decoder = json.JSONDecoder()
    body = body.lstrip()
    parsed, _ = decoder.raw_decode(body)
    sections[name.strip()] = parsed

for conversation_id, mobile in sections.items():
    golden = json.loads((golden_dir / f"{conversation_id}.json").read_text())
    print(f"### {conversation_id}")
    mobile_feed = mobile["feed"]
    golden_feed = golden["feed"]
    print(f"  feed: mobile {len(mobile_feed)} 行 / desktop {len(golden_feed)} 行")
    for index in range(max(len(mobile_feed), len(golden_feed))):
        left = mobile_feed[index] if index < len(mobile_feed) else None
        right = golden_feed[index] if index < len(golden_feed) else None
        if left == right:
            continue
        if left is None or right is None:
            print(f"    [{index}] 只有一边有：mobile={left} desktop={right}")
            continue
        fields = [
            field
            for field in ("text", "role", "at", "callId", "status", "final")
            if left.get(field) != right.get(field)
        ]
        preview = {
            field: (
                f"mobile={str(left.get(field))[:60]!r} desktop={str(right.get(field))[:60]!r}"
            )
            for field in fields
        }
        print(f"    [{index}] role={left.get('role')} 差异字段: {preview}")
    mobile_cards = {card["agentId"]: card for card in mobile["cards"]}
    golden_cards = {card["agentId"]: card for card in golden["cards"]}
    if set(mobile_cards) != set(golden_cards):
        print(
            f"  cards: mobile {sorted(mobile_cards)} desktop {sorted(golden_cards)}"
        )
    for agent_id in sorted(set(mobile_cards) & set(golden_cards)):
        left = mobile_cards[agent_id]
        right = golden_cards[agent_id]
        for field in ("role", "kind", "status", "missionText", "taskName", "parentToolUseId"):
            if left.get(field) != right.get(field):
                print(
                    f"  card {agent_id} {field}: mobile={left.get(field)!r} desktop={right.get(field)!r}"
                )
        if len(left["rows"]) != len(right["rows"]):
            print(
                f"  card {agent_id} rows: mobile {len(left['rows'])} / desktop {len(right['rows'])}"
            )
        for index, (left_row, right_row) in enumerate(zip(left["rows"], right["rows"])):
            if left_row != right_row:
                print(f"    card row [{index}] mobile={left_row} desktop={right_row}")
    if mobile["attempts"] != golden["attempts"]:
        print(f"  attempts: mobile {mobile['attempts']} desktop {golden['attempts']}")
    print()
