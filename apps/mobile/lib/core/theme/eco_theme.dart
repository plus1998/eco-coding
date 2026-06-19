import 'package:flutter/material.dart';

/// Color tokens aligned with [apps/desktop/src/renderer/themes.css] dark theme.
abstract final class EcoColors {
  static const bgMain = Color(0xFF212121);
  static const bgSidebar = Color(0xFF1A1A1A);
  static const bgElevated = Color(0xFF2B2B2B);
  static const bgElevatedHover = Color(0xFF323232);
  static const bgInput = Color(0xFF1F1F1F);
  static const bgMenu = Color(0xFF242424);

  static const textPrimary = Color(0xFFE8E8E8);
  static const textHeading = Color(0xFFF5F5F5);
  static const textMuted = Color(0xFF8A8A8A);
  static const textSecondary = Color(0xFFA3A3A3);

  static const borderSubtle = Color(0xFF383838);
  static const borderStrong = Color(0xFF404040);
  static const borderSidebar = Color(0xFF2F2F2F);

  static const accent = Color(0xFF3B82F6);
  static const accentHover = Color(0xFF2563EB);
  static const accentSoft = Color(0x263B82F6);
  static const accentText = Color(0xFF93C5FD);

  static const danger = Color(0xFFF87171);
  static const dangerSoft = Color(0x1FF87171);

  static const success = Color(0xFF86EFAC);
  static const statusAllowBg = Color(0x1A22C55E);
  static const statusAllowBorder = Color(0x4722C55E);
  static const statusAllowText = Color(0xFF86EFAC);

  static const statusDenyBg = Color(0x1AF87171);
  static const statusDenyBorder = Color(0x47F87171);
  static const statusDenyText = Color(0xFFFCA5A5);

  static const statusWarnBg = Color(0x1AF59E0B);
  static const statusWarnText = Color(0xFFFCD34D);

  static const cardSurface = Color(0xFF222222);
  static const cardSurfaceBorder = Color(0xFF2E2E2E);
  static const codeBg = Color(0x0FFFFFFF);

  static const composerContextBg = Color(0xFF303030);
  static const composerPillBg = Color(0xFF252525);
  static const composerPillBorder = Color(0xFF343434);

  static const navHover = Color(0x0FFFFFFF);
  static const navActive = Color(0x1AFFFFFF);

  static const composerSendBg = Color(0xFFE8E8E8);
  static const composerSendText = Color(0xFF1A1A1A);

  static const online = Color(0xFF86EFAC);
  static const offline = Color(0xFF737373);
}

class EcoThemeExtras extends ThemeExtension<EcoThemeExtras> {
  const EcoThemeExtras({
    required this.textMuted,
    required this.textSecondary,
    required this.borderSubtle,
    required this.accentSoft,
    required this.accentText,
    required this.statusAllowBg,
    required this.statusAllowText,
    required this.statusDenyBg,
    required this.statusDenyText,
    required this.statusWarnText,
    required this.cardSurface,
    required this.cardBorder,
    required this.assistantBubble,
    required this.userBubble,
    required this.online,
    required this.offline,
  });

  final Color textMuted;
  final Color textSecondary;
  final Color borderSubtle;
  final Color accentSoft;
  final Color accentText;
  final Color statusAllowBg;
  final Color statusAllowText;
  final Color statusDenyBg;
  final Color statusDenyText;
  final Color statusWarnText;
  final Color cardSurface;
  final Color cardBorder;
  final Color assistantBubble;
  final Color userBubble;
  final Color online;
  final Color offline;

  static const dark = EcoThemeExtras(
    textMuted: EcoColors.textMuted,
    textSecondary: EcoColors.textSecondary,
    borderSubtle: EcoColors.borderSubtle,
    accentSoft: EcoColors.accentSoft,
    accentText: EcoColors.accentText,
    statusAllowBg: EcoColors.statusAllowBg,
    statusAllowText: EcoColors.statusAllowText,
    statusDenyBg: EcoColors.statusDenyBg,
    statusDenyText: EcoColors.statusDenyText,
    statusWarnText: EcoColors.statusWarnText,
    cardSurface: EcoColors.cardSurface,
    cardBorder: EcoColors.cardSurfaceBorder,
    assistantBubble: EcoColors.composerContextBg,
    userBubble: EcoColors.accentSoft,
    online: EcoColors.online,
    offline: EcoColors.offline,
  );

  @override
  EcoThemeExtras copyWith({
    Color? textMuted,
    Color? textSecondary,
    Color? borderSubtle,
    Color? accentSoft,
    Color? accentText,
    Color? statusAllowBg,
    Color? statusAllowText,
    Color? statusDenyBg,
    Color? statusDenyText,
    Color? statusWarnText,
    Color? cardSurface,
    Color? cardBorder,
    Color? assistantBubble,
    Color? userBubble,
    Color? online,
    Color? offline,
  }) {
    return EcoThemeExtras(
      textMuted: textMuted ?? this.textMuted,
      textSecondary: textSecondary ?? this.textSecondary,
      borderSubtle: borderSubtle ?? this.borderSubtle,
      accentSoft: accentSoft ?? this.accentSoft,
      accentText: accentText ?? this.accentText,
      statusAllowBg: statusAllowBg ?? this.statusAllowBg,
      statusAllowText: statusAllowText ?? this.statusAllowText,
      statusDenyBg: statusDenyBg ?? this.statusDenyBg,
      statusDenyText: statusDenyText ?? this.statusDenyText,
      statusWarnText: statusWarnText ?? this.statusWarnText,
      cardSurface: cardSurface ?? this.cardSurface,
      cardBorder: cardBorder ?? this.cardBorder,
      assistantBubble: assistantBubble ?? this.assistantBubble,
      userBubble: userBubble ?? this.userBubble,
      online: online ?? this.online,
      offline: offline ?? this.offline,
    );
  }

  @override
  EcoThemeExtras lerp(ThemeExtension<EcoThemeExtras>? other, double t) {
    return other is EcoThemeExtras ? other : this;
  }
}

EcoThemeExtras ecoThemeExtras(BuildContext context) {
  return Theme.of(context).extension<EcoThemeExtras>() ?? EcoThemeExtras.dark;
}

ThemeData buildEcoTheme() {
  const colorScheme = ColorScheme.dark(
    brightness: Brightness.dark,
    primary: EcoColors.accent,
    onPrimary: Colors.white,
    primaryContainer: EcoColors.accentSoft,
    onPrimaryContainer: EcoColors.accentText,
    secondary: EcoColors.textSecondary,
    onSecondary: EcoColors.textPrimary,
    surface: EcoColors.bgElevated,
    onSurface: EcoColors.textPrimary,
    error: EcoColors.danger,
    onError: Colors.white,
    outline: EcoColors.borderSubtle,
    surfaceContainerHighest: EcoColors.bgElevatedHover,
    surfaceContainerHigh: EcoColors.cardSurface,
    surfaceContainer: EcoColors.bgMenu,
    surfaceContainerLow: EcoColors.bgSidebar,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: EcoColors.bgMain,
    colorScheme: colorScheme,
    extensions: const [EcoThemeExtras.dark],
    fontFamily: '.AppleSystemUIFont',
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        color: EcoColors.textHeading,
        fontWeight: FontWeight.w600,
      ),
      titleMedium: TextStyle(
        color: EcoColors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 15,
      ),
      titleSmall: TextStyle(
        color: EcoColors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
      bodyLarge: TextStyle(color: EcoColors.textPrimary, fontSize: 14),
      bodyMedium: TextStyle(color: EcoColors.textPrimary, fontSize: 13),
      bodySmall: TextStyle(color: EcoColors.textSecondary, fontSize: 12),
      labelLarge: TextStyle(
        color: EcoColors.textPrimary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
      ),
      labelSmall: TextStyle(color: EcoColors.textMuted, fontSize: 11),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: EcoColors.bgMain,
      foregroundColor: EcoColors.textPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: EcoColors.textHeading,
        fontSize: 17,
        fontWeight: FontWeight.w600,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: EcoColors.bgSidebar,
      indicatorColor: EcoColors.navActive,
      elevation: 0,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const TextStyle(
            color: EcoColors.textHeading,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          );
        }
        return const TextStyle(color: EcoColors.textMuted, fontSize: 12);
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(color: EcoColors.textHeading, size: 22);
        }
        return const IconThemeData(color: EcoColors.textMuted, size: 22);
      }),
    ),
    cardTheme: CardThemeData(
      color: EcoColors.bgElevated,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: EcoColors.borderSubtle),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: EcoColors.bgInput,
      hintStyle: const TextStyle(color: EcoColors.textMuted),
      labelStyle: const TextStyle(color: EcoColors.textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: EcoColors.borderSubtle),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: EcoColors.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: EcoColors.accent, width: 1.5),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: EcoColors.borderSubtle,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: EcoColors.textSecondary,
      textColor: EcoColors.textPrimary,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return EcoColors.accent;
          }
          return EcoColors.bgElevated;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return Colors.white;
          }
          return EcoColors.textPrimary;
        }),
        side: WidgetStateProperty.all(
          const BorderSide(color: EcoColors.borderSubtle),
        ),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: EcoColors.accent,
        foregroundColor: Colors.white,
        disabledBackgroundColor: EcoColors.borderStrong,
        disabledForegroundColor: EcoColors.textMuted,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: EcoColors.textPrimary,
        backgroundColor: EcoColors.bgElevated,
        disabledForegroundColor: EcoColors.textMuted,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        side: const BorderSide(color: EcoColors.borderSubtle),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: EcoColors.composerPillBg,
      disabledColor: EcoColors.bgElevated,
      selectedColor: EcoColors.accentSoft,
      labelStyle: const TextStyle(color: EcoColors.textSecondary, fontSize: 12),
      secondaryLabelStyle: const TextStyle(color: EcoColors.accentText),
      side: const BorderSide(color: EcoColors.composerPillBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: EcoColors.bgMenu,
      contentTextStyle: const TextStyle(color: EcoColors.textPrimary),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: EcoColors.borderSubtle),
      ),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: EcoColors.accent,
      linearTrackColor: EcoColors.borderSubtle,
    ),
    iconButtonTheme: IconButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.all(EcoColors.textSecondary),
      ),
    ),
    floatingActionButtonTheme: const FloatingActionButtonThemeData(
      backgroundColor: EcoColors.accent,
      foregroundColor: Colors.white,
      elevation: 2,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: EcoColors.bgElevated,
      modalBackgroundColor: EcoColors.bgElevated,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        side: BorderSide(color: EcoColors.borderSubtle),
      ),
    ),
    popupMenuTheme: const PopupMenuThemeData(
      color: EcoColors.bgMenu,
      surfaceTintColor: Colors.transparent,
      textStyle: TextStyle(color: EcoColors.textPrimary, fontSize: 13),
    ),
  );
}

/// Tonal button matching desktop `.settings-secondary-button`.
ButtonStyle ecoTonalButtonStyle(BuildContext context) {
  return OutlinedButton.styleFrom(
    foregroundColor: EcoColors.textPrimary,
    backgroundColor: EcoColors.bgElevated,
    side: const BorderSide(color: EcoColors.borderSubtle),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    minimumSize: const Size(0, 40),
    padding: const EdgeInsets.symmetric(horizontal: 14),
    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
  );
}
