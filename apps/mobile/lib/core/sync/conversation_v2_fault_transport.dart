/// Deterministic transport fault injector used by V2 sync/recovery tests.
///
/// It deliberately knows nothing about Supabase or RPC.  The real transport
/// remains responsible for delivery; this helper only models the properties
/// the sync protocol must tolerate: loss, duplication, delay, reordering,
/// disconnects and bounded buffering.  A seed makes every failure replayable.
class ConversationV2FaultPlan {
  const ConversationV2FaultPlan({
    this.seed = 1,
    this.dropRate = 0,
    this.duplicateRate = 0,
    this.delayRate = 0,
    this.reorderWindow = 1,
    this.maxBufferedPackets = 128,
    this.disconnectOnFirstTransmit = false,
  }) : assert(dropRate >= 0 && dropRate <= 1),
       assert(duplicateRate >= 0 && duplicateRate <= 1),
       assert(delayRate >= 0 && delayRate <= 1),
       assert(reorderWindow > 0),
       assert(maxBufferedPackets > 0);

  final int seed;
  final double dropRate;
  final double duplicateRate;
  final double delayRate;
  final int reorderWindow;
  final int maxBufferedPackets;
  final bool disconnectOnFirstTransmit;
}

class ConversationV2FaultDelivery<T> {
  const ConversationV2FaultDelivery({
    required this.packets,
    required this.dropped,
    required this.duplicated,
    required this.delayed,
    required this.disconnected,
    required this.bufferOverflow,
  });

  final List<T> packets;
  final int dropped;
  final int duplicated;
  final int delayed;
  final bool disconnected;
  final bool bufferOverflow;
}

/// Applies a deterministic set of transport faults to packet batches.
///
/// `sequenceOf` is only used to make reordering deterministic and visible in
/// diagnostics; it is not assumed to be contiguous.  Call [reconnect] after
/// simulating a disconnect, then transmit an empty batch to flush delayed
/// packets.
class ConversationV2FaultTransport<T> {
  ConversationV2FaultTransport({required this.plan, required this.sequenceOf})
    : _random = _SeededRandom(plan.seed);

  final ConversationV2FaultPlan plan;
  final int Function(T packet) sequenceOf;
  final _SeededRandom _random;
  final List<T> _delayedPackets = [];
  bool _firstTransmit = true;
  bool _disconnected = false;

  bool get disconnected => _disconnected;
  int get bufferedPackets => _delayedPackets.length;

  ConversationV2FaultDelivery<T> transmit(Iterable<T> input) {
    final source = input.toList(growable: false);
    if (_disconnected) {
      return ConversationV2FaultDelivery(
        packets: const [],
        dropped: source.length,
        duplicated: 0,
        delayed: 0,
        disconnected: true,
        bufferOverflow: false,
      );
    }
    if (_firstTransmit && plan.disconnectOnFirstTransmit) {
      _firstTransmit = false;
      _disconnected = true;
      _delayedPackets.addAll(source);
      var bufferOverflow = false;
      while (_delayedPackets.length > plan.maxBufferedPackets) {
        _delayedPackets.removeAt(0);
        bufferOverflow = true;
      }
      return ConversationV2FaultDelivery(
        packets: const [],
        dropped: 0,
        duplicated: 0,
        delayed: source.length,
        disconnected: true,
        bufferOverflow: bufferOverflow,
      );
    }
    _firstTransmit = false;

    final delivered = <T>[];
    var dropped = 0;
    var duplicated = 0;
    var delayed = 0;
    var bufferOverflow = false;

    // Delayed packets become eligible only on the next successful transport
    // turn.  This models a packet arriving after a reconnect without letting
    // it skip the normal client cursor checks in the same turn.
    delivered.addAll(_takeDelayed());
    for (final packet in source) {
      if (_random.hit(plan.dropRate)) {
        dropped += 1;
        continue;
      }
      if (_random.hit(plan.delayRate)) {
        _delayedPackets.add(packet);
        delayed += 1;
        if (_delayedPackets.length > plan.maxBufferedPackets) {
          _delayedPackets.removeAt(0);
          bufferOverflow = true;
        }
        continue;
      }
      delivered.add(packet);
      if (_random.hit(plan.duplicateRate)) {
        delivered.add(packet);
        duplicated += 1;
      }
    }

    return ConversationV2FaultDelivery(
      packets: _reorder(delivered),
      dropped: dropped,
      duplicated: duplicated,
      delayed: delayed,
      disconnected: false,
      bufferOverflow: bufferOverflow,
    );
  }

  void reconnect() {
    _disconnected = false;
  }

  List<T> _takeDelayed() {
    if (_delayedPackets.isEmpty) return const [];
    final result = List<T>.from(_delayedPackets);
    _delayedPackets.clear();
    return result;
  }

  List<T> _reorder(List<T> packets) {
    if (packets.length < 2 || plan.reorderWindow <= 1) return packets;
    final result = <T>[];
    for (
      var offset = 0;
      offset < packets.length;
      offset += plan.reorderWindow
    ) {
      final end = (offset + plan.reorderWindow) < packets.length
          ? offset + plan.reorderWindow
          : packets.length;
      final window = packets.sublist(offset, end);
      // Mix a deterministic rotation with reversal so tests cover more than
      // one fixed ordering while still producing a compact replay seed.
      if (_random.nextInt(2) == 0) {
        final reversed = window.reversed.toList(growable: false);
        window
          ..clear()
          ..addAll(reversed);
      } else if (window.length > 1) {
        final first = window.removeAt(0);
        window.add(first);
      }
      result.addAll(window);
    }
    // Keep the sequence accessor exercised in diagnostics/debuggers and make
    // the contract explicit: ordering is transport order, never sequence
    // order.  Do not sort here.
    for (final packet in result) {
      sequenceOf(packet);
    }
    return result;
  }
}

class _SeededRandom {
  _SeededRandom(int seed) : _state = seed == 0 ? 1 : seed.abs();

  int _state;

  double nextDouble() {
    _state = (1103515245 * _state + 12345) & 0x7fffffff;
    return _state / 0x80000000;
  }

  int nextInt(int max) {
    if (max <= 0) throw ArgumentError.value(max, 'max');
    return (nextDouble() * max).floor();
  }

  bool hit(double probability) => probability > 0 && nextDouble() < probability;
}
