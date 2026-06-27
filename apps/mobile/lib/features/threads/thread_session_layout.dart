import 'package:flutter/material.dart';

import 'thread_session_app_bar.dart';

/// Horizontal inset for the activity feed list content.
const threadSessionFeedHorizontalPadding = 12.0;

/// Breathing room between the last feed row and the composer dock.
const threadSessionComposerGap = 8.0;

/// Column shell: feed fills space below the frosted toolbar; composer docks at bottom.
///
/// Top inset is applied on the feed viewport (not inside scroll padding) so content
/// never draws under the app bar, while [extendBodyBehindAppBar] keeps the frost.
class ThreadSessionConversationLayout extends StatelessWidget {
  const ThreadSessionConversationLayout({
    super.key,
    required this.feed,
    required this.composer,
  });

  final Widget feed;
  final Widget composer;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: Padding(
            padding: EdgeInsets.only(
              top: sessionContentTopPadding(context),
            ),
            child: feed,
          ),
        ),
        composer,
      ],
    );
  }
}
