import 'package:flutter/material.dart';

class AppThemeMediaQuery extends StatelessWidget {
  const AppThemeMediaQuery({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(platformBrightness: Theme.of(context).brightness),
      child: child,
    );
  }
}
