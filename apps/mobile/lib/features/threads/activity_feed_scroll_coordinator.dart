import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

/// Chat feed scroll: [ListView.reverse] anchors the tail at the visual bottom.
class ActivityFeedScrollCoordinator {
  ActivityFeedScrollCoordinator(this.scrollController);

  final ScrollController scrollController;

  static const stickThreshold = 96.0;
  static const userScrollDelta = 4.0;

  bool userDetachedFromBottom = false;
  bool _programmaticScroll = false;
  double _lastScrollPixels = 0;

  bool get hasClients => scrollController.hasClients;

  double get distanceFromBottom {
    if (!hasClients) return double.infinity;
    return scrollController.position.pixels;
  }

  bool get isPinnedToBottom => distanceFromBottom <= stickThreshold;

  void onScrollNotification(ScrollNotification notification) {
    if (!hasClients || _programmaticScroll) return;

    final pixels = scrollController.position.pixels;
    final dist = distanceFromBottom;

    if (notification is ScrollEndNotification && dist <= stickThreshold) {
      userDetachedFromBottom = false;
    }

    if (notification is ScrollUpdateNotification &&
        notification.dragDetails != null) {
      if (pixels > stickThreshold) {
        userDetachedFromBottom = true;
      } else if (dist <= stickThreshold) {
        userDetachedFromBottom = false;
      }
    }

    // reverse ListView: pixels increase = scroll away from bottom (up).
    if (pixels > _lastScrollPixels + userScrollDelta) {
      userDetachedFromBottom = true;
    } else if (pixels < _lastScrollPixels - userScrollDelta) {
      if (dist <= stickThreshold) {
        userDetachedFromBottom = false;
      }
    } else if (dist <= stickThreshold) {
      userDetachedFromBottom = false;
    }

    _lastScrollPixels = pixels;
    clampOverscroll();
  }

  void clampOverscroll() {
    if (!hasClients) return;
    final position = scrollController.position;
    if (position.pixels < 0) {
      _markProgrammatic(() => scrollController.jumpTo(0));
    } else if (position.pixels > position.maxScrollExtent) {
      _markProgrammatic(
        () => scrollController.jumpTo(position.maxScrollExtent),
      );
    }
  }

  void scrollToEnd({bool force = false}) {
    if (!hasClients) return;
    if (!force && userDetachedFromBottom) return;
    final pixelsBefore = scrollController.position.pixels;
    if (!force && pixelsBefore.abs() < 0.5) {
      userDetachedFromBottom = false;
      return;
    }
    _markProgrammatic(() => scrollController.jumpTo(0));
    if (force) {
      userDetachedFromBottom = false;
    }
  }

  void forceScrollToEnd() {
    userDetachedFromBottom = false;
    scrollToEnd(force: true);
    SchedulerBinding.instance.addPostFrameCallback((_) {
      scrollToEnd(force: true);
    });
  }

  void _markProgrammatic(void Function() action) {
    _programmaticScroll = true;
    action();
    SchedulerBinding.instance.addPostFrameCallback((_) {
      _programmaticScroll = false;
      if (hasClients) {
        _lastScrollPixels = scrollController.position.pixels;
      }
    });
  }
}
