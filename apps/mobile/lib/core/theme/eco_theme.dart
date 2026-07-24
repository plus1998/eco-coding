import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Semantic color tokens aligned with [apps/desktop/src/renderer/themes.css].
@immutable
class EcoColors extends ThemeExtension<EcoColors> {
  const EcoColors({
    required this.bgMain,
    required this.bgSidebar,
    required this.bgElevated,
    required this.bgElevatedHover,
    required this.bgInput,
    required this.bgOverlay,
    required this.bgMenu,
    required this.textPrimary,
    required this.textHeading,
    required this.textMuted,
    required this.textSecondary,
    required this.borderSubtle,
    required this.borderStrong,
    required this.borderSidebar,
    required this.navHover,
    required this.navActive,
    required this.accent,
    required this.accentHover,
    required this.accentSoft,
    required this.accentText,
    required this.danger,
    required this.dangerSoft,
    required this.success,
    required this.statusAllowBg,
    required this.statusAllowBorder,
    required this.statusAllowText,
    required this.statusDenyBg,
    required this.statusDenyBorder,
    required this.statusDenyText,
    required this.statusWarnBg,
    required this.statusWarnBorder,
    required this.statusWarnText,
    required this.cardSurface,
    required this.cardSurfaceBorder,
    required this.codeBg,
    required this.composerContextBg,
    required this.composerPillBg,
    required this.composerPillBorder,
    required this.composerPillText,
    required this.composerSendBg,
    required this.composerSendText,
    required this.composerSendDisabledBg,
    required this.composerSendDisabledText,
    required this.online,
    required this.offline,
    required this.assistantBubble,
    required this.userBubble,
    required this.onAccent,
    required this.shimmerHighlight,
    required this.shadowScrim,
    required this.statusRunning,
    required this.statusCompleted,
    required this.warnAccent,
    required this.severityHigh,
    required this.severityDefault,
    required this.voiceRecordBg,
  });

  final Color bgMain;
  final Color bgSidebar;
  final Color bgElevated;
  final Color bgElevatedHover;
  final Color bgInput;
  final Color bgOverlay;
  final Color bgMenu;
  final Color textPrimary;
  final Color textHeading;
  final Color textMuted;
  final Color textSecondary;
  final Color borderSubtle;
  final Color borderStrong;
  final Color borderSidebar;
  final Color navHover;
  final Color navActive;
  final Color accent;
  final Color accentHover;
  final Color accentSoft;
  final Color accentText;
  final Color danger;
  final Color dangerSoft;
  final Color success;
  final Color statusAllowBg;
  final Color statusAllowBorder;
  final Color statusAllowText;
  final Color statusDenyBg;
  final Color statusDenyBorder;
  final Color statusDenyText;
  final Color statusWarnBg;
  final Color statusWarnBorder;
  final Color statusWarnText;
  final Color cardSurface;
  final Color cardSurfaceBorder;
  final Color codeBg;
  final Color composerContextBg;
  final Color composerPillBg;
  final Color composerPillBorder;
  final Color composerPillText;
  final Color composerSendBg;
  final Color composerSendText;
  final Color composerSendDisabledBg;
  final Color composerSendDisabledText;
  final Color online;
  final Color offline;
  final Color assistantBubble;
  final Color userBubble;
  final Color onAccent;
  final Color shimmerHighlight;
  final Color shadowScrim;
  final Color statusRunning;
  final Color statusCompleted;
  final Color warnAccent;
  final Color severityHigh;
  final Color severityDefault;
  final Color voiceRecordBg;

  // Aliases used by older call sites.
  Color get cardBorder => cardSurfaceBorder;

  /// iOS dark: systemGroupedBackground + secondary fills (not desktop gray).
  static const dark = EcoColors(
    bgMain: Color(0xFF000000),
    bgSidebar: Color(0xFF000000),
    bgElevated: Color(0xFF1C1C1E),
    bgElevatedHover: Color(0xFF2C2C2E),
    bgInput: Color(0xFF1C1C1E),
    bgOverlay: Color(0x99000000),
    bgMenu: Color(0xFF2C2C2E),
    textPrimary: Color(0xFFFFFFFF),
    textHeading: Color(0xFFFFFFFF),
    textMuted: Color(0x99EBEBF5),
    textSecondary: Color(0xB3EBEBF5),
    borderSubtle: Color(0xFF38383A),
    borderStrong: Color(0xFF48484A),
    borderSidebar: Color(0xFF1C1C1E),
    navHover: Color(0x14FFFFFF),
    navActive: Color(0x1FFFFFFF),
    accent: Color(0xFF0A84FF),
    accentHover: Color(0xFF409CFF),
    accentSoft: Color(0x330A84FF),
    accentText: Color(0xFF64D2FF),
    danger: Color(0xFFFF453A),
    dangerSoft: Color(0x26FF453A),
    success: Color(0xFF30D158),
    statusAllowBg: Color(0x2630D158),
    statusAllowBorder: Color(0x4730D158),
    statusAllowText: Color(0xFF30D158),
    statusDenyBg: Color(0x26FF453A),
    statusDenyBorder: Color(0x47FF453A),
    statusDenyText: Color(0xFFFF6961),
    statusWarnBg: Color(0x26FF9F0A),
    statusWarnBorder: Color(0x47FF9F0A),
    statusWarnText: Color(0xFFFFD60A),
    cardSurface: Color(0xFF1C1C1E),
    cardSurfaceBorder: Color(0xFF38383A),
    codeBg: Color(0x14FFFFFF),
    composerContextBg: Color(0xFF2C2C2E),
    composerPillBg: Color(0xFF3A3A3C),
    composerPillBorder: Color(0xFF48484A),
    composerPillText: Color(0xB3EBEBF5),
    composerSendBg: Color(0xFFFFFFFF),
    composerSendText: Color(0xFF000000),
    composerSendDisabledBg: Color(0xFF3A3A3C),
    composerSendDisabledText: Color(0x66EBEBF5),
    online: Color(0xFF30D158),
    offline: Color(0x66EBEBF5),
    assistantBubble: Color(0xFF2C2C2E),
    userBubble: Color(0x330A84FF),
    onAccent: Color(0xFFFFFFFF),
    shimmerHighlight: Color(0xFFFFFFFF),
    shadowScrim: Color(0xFF000000),
    statusRunning: Color(0xFF30D158),
    statusCompleted: Color(0xFF0A84FF),
    warnAccent: Color(0xFFFF9F0A),
    severityHigh: Color(0xFFFF453A),
    severityDefault: Color(0xFFFF9F0A),
    voiceRecordBg: Color(0xFF1C1C1E),
  );

  /// iOS light: systemGroupedBackground canvas + white secondary groups.
  static const light = EcoColors(
    bgMain: Color(0xFFF2F2F7),
    bgSidebar: Color(0xFFF2F2F7),
    bgElevated: Color(0xFFFFFFFF),
    bgElevatedHover: Color(0xFFE5E5EA),
    bgInput: Color(0xFFFFFFFF),
    bgOverlay: Color(0x52000000),
    bgMenu: Color(0xFFF2F2F7),
    textPrimary: Color(0xFF000000),
    textHeading: Color(0xFF000000),
    textMuted: Color(0x993C3C43),
    textSecondary: Color(0x993C3C43),
    borderSubtle: Color(0x293C3C43),
    borderStrong: Color(0x3D3C3C43),
    borderSidebar: Color(0x143C3C43),
    navHover: Color(0x0A000000),
    navActive: Color(0x14000000),
    accent: Color(0xFF007AFF),
    accentHover: Color(0xFF0066D6),
    accentSoft: Color(0x1F007AFF),
    accentText: Color(0xFF007AFF),
    danger: Color(0xFFFF3B30),
    dangerSoft: Color(0x14FF3B30),
    success: Color(0xFF34C759),
    statusAllowBg: Color(0x1A34C759),
    statusAllowBorder: Color(0x4734C759),
    statusAllowText: Color(0xFF248A3D),
    statusDenyBg: Color(0x14FF3B30),
    statusDenyBorder: Color(0x47FF3B30),
    statusDenyText: Color(0xFFFF3B30),
    statusWarnBg: Color(0x1FFF9500),
    statusWarnBorder: Color(0x59FF9500),
    statusWarnText: Color(0xFFC93400),
    cardSurface: Color(0xFFFFFFFF),
    cardSurfaceBorder: Color(0x293C3C43),
    codeBg: Color(0x0A000000),
    composerContextBg: Color(0xFFFFFFFF),
    composerPillBg: Color(0xFFF2F2F7),
    composerPillBorder: Color(0x143C3C43),
    composerPillText: Color(0x993C3C43),
    composerSendBg: Color(0xFF007AFF),
    composerSendText: Color(0xFFFFFFFF),
    composerSendDisabledBg: Color(0xFFE5E5EA),
    composerSendDisabledText: Color(0x4D3C3C43),
    online: Color(0xFF34C759),
    offline: Color(0x4D3C3C43),
    assistantBubble: Color(0xFFE5E5EA),
    userBubble: Color(0x1F007AFF),
    onAccent: Color(0xFFFFFFFF),
    shimmerHighlight: Color(0xFFFFFFFF),
    shadowScrim: Color(0xFF000000),
    statusRunning: Color(0xFF34C759),
    statusCompleted: Color(0xFF007AFF),
    warnAccent: Color(0xFFFF9500),
    severityHigh: Color(0xFFFF3B30),
    severityDefault: Color(0xFFFF9500),
    voiceRecordBg: Color(0xFF1C1C1E),
  );

  @override
  EcoColors copyWith({
    Color? bgMain,
    Color? bgSidebar,
    Color? bgElevated,
    Color? bgElevatedHover,
    Color? bgInput,
    Color? bgOverlay,
    Color? bgMenu,
    Color? textPrimary,
    Color? textHeading,
    Color? textMuted,
    Color? textSecondary,
    Color? borderSubtle,
    Color? borderStrong,
    Color? borderSidebar,
    Color? navHover,
    Color? navActive,
    Color? accent,
    Color? accentHover,
    Color? accentSoft,
    Color? accentText,
    Color? danger,
    Color? dangerSoft,
    Color? success,
    Color? statusAllowBg,
    Color? statusAllowBorder,
    Color? statusAllowText,
    Color? statusDenyBg,
    Color? statusDenyBorder,
    Color? statusDenyText,
    Color? statusWarnBg,
    Color? statusWarnBorder,
    Color? statusWarnText,
    Color? cardSurface,
    Color? cardSurfaceBorder,
    Color? codeBg,
    Color? composerContextBg,
    Color? composerPillBg,
    Color? composerPillBorder,
    Color? composerPillText,
    Color? composerSendBg,
    Color? composerSendText,
    Color? composerSendDisabledBg,
    Color? composerSendDisabledText,
    Color? online,
    Color? offline,
    Color? assistantBubble,
    Color? userBubble,
    Color? onAccent,
    Color? shimmerHighlight,
    Color? shadowScrim,
    Color? statusRunning,
    Color? statusCompleted,
    Color? warnAccent,
    Color? severityHigh,
    Color? severityDefault,
    Color? voiceRecordBg,
  }) {
    return EcoColors(
      bgMain: bgMain ?? this.bgMain,
      bgSidebar: bgSidebar ?? this.bgSidebar,
      bgElevated: bgElevated ?? this.bgElevated,
      bgElevatedHover: bgElevatedHover ?? this.bgElevatedHover,
      bgInput: bgInput ?? this.bgInput,
      bgOverlay: bgOverlay ?? this.bgOverlay,
      bgMenu: bgMenu ?? this.bgMenu,
      textPrimary: textPrimary ?? this.textPrimary,
      textHeading: textHeading ?? this.textHeading,
      textMuted: textMuted ?? this.textMuted,
      textSecondary: textSecondary ?? this.textSecondary,
      borderSubtle: borderSubtle ?? this.borderSubtle,
      borderStrong: borderStrong ?? this.borderStrong,
      borderSidebar: borderSidebar ?? this.borderSidebar,
      navHover: navHover ?? this.navHover,
      navActive: navActive ?? this.navActive,
      accent: accent ?? this.accent,
      accentHover: accentHover ?? this.accentHover,
      accentSoft: accentSoft ?? this.accentSoft,
      accentText: accentText ?? this.accentText,
      danger: danger ?? this.danger,
      dangerSoft: dangerSoft ?? this.dangerSoft,
      success: success ?? this.success,
      statusAllowBg: statusAllowBg ?? this.statusAllowBg,
      statusAllowBorder: statusAllowBorder ?? this.statusAllowBorder,
      statusAllowText: statusAllowText ?? this.statusAllowText,
      statusDenyBg: statusDenyBg ?? this.statusDenyBg,
      statusDenyBorder: statusDenyBorder ?? this.statusDenyBorder,
      statusDenyText: statusDenyText ?? this.statusDenyText,
      statusWarnBg: statusWarnBg ?? this.statusWarnBg,
      statusWarnBorder: statusWarnBorder ?? this.statusWarnBorder,
      statusWarnText: statusWarnText ?? this.statusWarnText,
      cardSurface: cardSurface ?? this.cardSurface,
      cardSurfaceBorder: cardSurfaceBorder ?? this.cardSurfaceBorder,
      codeBg: codeBg ?? this.codeBg,
      composerContextBg: composerContextBg ?? this.composerContextBg,
      composerPillBg: composerPillBg ?? this.composerPillBg,
      composerPillBorder: composerPillBorder ?? this.composerPillBorder,
      composerPillText: composerPillText ?? this.composerPillText,
      composerSendBg: composerSendBg ?? this.composerSendBg,
      composerSendText: composerSendText ?? this.composerSendText,
      composerSendDisabledBg:
          composerSendDisabledBg ?? this.composerSendDisabledBg,
      composerSendDisabledText:
          composerSendDisabledText ?? this.composerSendDisabledText,
      online: online ?? this.online,
      offline: offline ?? this.offline,
      assistantBubble: assistantBubble ?? this.assistantBubble,
      userBubble: userBubble ?? this.userBubble,
      onAccent: onAccent ?? this.onAccent,
      shimmerHighlight: shimmerHighlight ?? this.shimmerHighlight,
      shadowScrim: shadowScrim ?? this.shadowScrim,
      statusRunning: statusRunning ?? this.statusRunning,
      statusCompleted: statusCompleted ?? this.statusCompleted,
      warnAccent: warnAccent ?? this.warnAccent,
      severityHigh: severityHigh ?? this.severityHigh,
      severityDefault: severityDefault ?? this.severityDefault,
      voiceRecordBg: voiceRecordBg ?? this.voiceRecordBg,
    );
  }

  @override
  EcoColors lerp(ThemeExtension<EcoColors>? other, double t) {
    if (other is! EcoColors) return this;
    Color blend(Color a, Color b) => Color.lerp(a, b, t)!;
    return EcoColors(
      bgMain: blend(bgMain, other.bgMain),
      bgSidebar: blend(bgSidebar, other.bgSidebar),
      bgElevated: blend(bgElevated, other.bgElevated),
      bgElevatedHover: blend(bgElevatedHover, other.bgElevatedHover),
      bgInput: blend(bgInput, other.bgInput),
      bgOverlay: blend(bgOverlay, other.bgOverlay),
      bgMenu: blend(bgMenu, other.bgMenu),
      textPrimary: blend(textPrimary, other.textPrimary),
      textHeading: blend(textHeading, other.textHeading),
      textMuted: blend(textMuted, other.textMuted),
      textSecondary: blend(textSecondary, other.textSecondary),
      borderSubtle: blend(borderSubtle, other.borderSubtle),
      borderStrong: blend(borderStrong, other.borderStrong),
      borderSidebar: blend(borderSidebar, other.borderSidebar),
      navHover: blend(navHover, other.navHover),
      navActive: blend(navActive, other.navActive),
      accent: blend(accent, other.accent),
      accentHover: blend(accentHover, other.accentHover),
      accentSoft: blend(accentSoft, other.accentSoft),
      accentText: blend(accentText, other.accentText),
      danger: blend(danger, other.danger),
      dangerSoft: blend(dangerSoft, other.dangerSoft),
      success: blend(success, other.success),
      statusAllowBg: blend(statusAllowBg, other.statusAllowBg),
      statusAllowBorder: blend(statusAllowBorder, other.statusAllowBorder),
      statusAllowText: blend(statusAllowText, other.statusAllowText),
      statusDenyBg: blend(statusDenyBg, other.statusDenyBg),
      statusDenyBorder: blend(statusDenyBorder, other.statusDenyBorder),
      statusDenyText: blend(statusDenyText, other.statusDenyText),
      statusWarnBg: blend(statusWarnBg, other.statusWarnBg),
      statusWarnBorder: blend(statusWarnBorder, other.statusWarnBorder),
      statusWarnText: blend(statusWarnText, other.statusWarnText),
      cardSurface: blend(cardSurface, other.cardSurface),
      cardSurfaceBorder: blend(cardSurfaceBorder, other.cardSurfaceBorder),
      codeBg: blend(codeBg, other.codeBg),
      composerContextBg: blend(composerContextBg, other.composerContextBg),
      composerPillBg: blend(composerPillBg, other.composerPillBg),
      composerPillBorder: blend(composerPillBorder, other.composerPillBorder),
      composerPillText: blend(composerPillText, other.composerPillText),
      composerSendBg: blend(composerSendBg, other.composerSendBg),
      composerSendText: blend(composerSendText, other.composerSendText),
      composerSendDisabledBg: blend(
        composerSendDisabledBg,
        other.composerSendDisabledBg,
      ),
      composerSendDisabledText: blend(
        composerSendDisabledText,
        other.composerSendDisabledText,
      ),
      online: blend(online, other.online),
      offline: blend(offline, other.offline),
      assistantBubble: blend(assistantBubble, other.assistantBubble),
      userBubble: blend(userBubble, other.userBubble),
      onAccent: blend(onAccent, other.onAccent),
      shimmerHighlight: blend(shimmerHighlight, other.shimmerHighlight),
      shadowScrim: blend(shadowScrim, other.shadowScrim),
      statusRunning: blend(statusRunning, other.statusRunning),
      statusCompleted: blend(statusCompleted, other.statusCompleted),
      warnAccent: blend(warnAccent, other.warnAccent),
      severityHigh: blend(severityHigh, other.severityHigh),
      severityDefault: blend(severityDefault, other.severityDefault),
      voiceRecordBg: blend(voiceRecordBg, other.voiceRecordBg),
    );
  }
}

EcoColors ecoColors(BuildContext context) {
  return Theme.of(context).extension<EcoColors>() ?? EcoColors.dark;
}

/// Backward-compatible alias for older call sites.
EcoColors ecoThemeExtras(BuildContext context) => ecoColors(context);

ThemeData buildEcoDarkTheme() => _buildEcoTheme(EcoColors.dark);

ThemeData buildEcoLightTheme() => _buildEcoTheme(EcoColors.light);

@Deprecated('Use buildEcoDarkTheme or buildEcoLightTheme')
ThemeData buildEcoTheme() => buildEcoDarkTheme();

ThemeData _buildEcoTheme(EcoColors colors) {
  final isDark = colors == EcoColors.dark;
  final colorScheme = isDark
      ? ColorScheme.dark(
          brightness: Brightness.dark,
          primary: colors.accent,
          onPrimary: colors.onAccent,
          primaryContainer: colors.accentSoft,
          onPrimaryContainer: colors.accentText,
          secondary: colors.textSecondary,
          onSecondary: colors.textPrimary,
          surface: colors.bgElevated,
          onSurface: colors.textPrimary,
          error: colors.danger,
          onError: colors.onAccent,
          outline: colors.borderSubtle,
          surfaceContainerHighest: colors.bgElevatedHover,
          surfaceContainerHigh: colors.cardSurface,
          surfaceContainer: colors.bgMenu,
          surfaceContainerLow: colors.bgSidebar,
        )
      : ColorScheme.light(
          brightness: Brightness.light,
          primary: colors.accent,
          onPrimary: colors.onAccent,
          primaryContainer: colors.accentSoft,
          onPrimaryContainer: colors.accentText,
          secondary: colors.textSecondary,
          onSecondary: colors.textPrimary,
          surface: colors.bgElevated,
          onSurface: colors.textPrimary,
          error: colors.danger,
          onError: colors.onAccent,
          outline: colors.borderSubtle,
          surfaceContainerHighest: colors.bgElevatedHover,
          surfaceContainerHigh: colors.cardSurface,
          surfaceContainer: colors.bgMenu,
          surfaceContainerLow: colors.bgSidebar,
        );

  return ThemeData(
    useMaterial3: true,
    brightness: isDark ? Brightness.dark : Brightness.light,
    scaffoldBackgroundColor: colors.bgMain,
    colorScheme: colorScheme,
    extensions: [colors],
    fontFamily: '.AppleSystemUIFont',
    // Optical sizing: tighten large titles, loosen body (§15).
    textTheme: TextTheme(
      displaySmall: TextStyle(
        color: colors.textHeading,
        fontSize: 34,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
        height: 1.05,
      ),
      headlineMedium: TextStyle(
        color: colors.textHeading,
        fontSize: 28,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
        height: 1.1,
      ),
      headlineSmall: TextStyle(
        color: colors.textHeading,
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.25,
        height: 1.15,
      ),
      titleLarge: TextStyle(
        color: colors.textHeading,
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.3,
        height: 1.2,
      ),
      titleMedium: TextStyle(
        color: colors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 17,
        letterSpacing: -0.25,
        height: 1.25,
      ),
      titleSmall: TextStyle(
        color: colors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 15,
        letterSpacing: -0.2,
        height: 1.25,
      ),
      bodyLarge: TextStyle(
        color: colors.textPrimary,
        fontSize: 17,
        letterSpacing: -0.2,
        height: 1.35,
      ),
      bodyMedium: TextStyle(
        color: colors.textPrimary,
        fontSize: 15,
        letterSpacing: -0.15,
        height: 1.35,
      ),
      bodySmall: TextStyle(
        color: colors.textSecondary,
        fontSize: 13,
        letterSpacing: -0.08,
        height: 1.35,
      ),
      labelLarge: TextStyle(
        color: colors.textPrimary,
        fontSize: 15,
        fontWeight: FontWeight.w500,
        letterSpacing: -0.15,
      ),
      labelMedium: TextStyle(
        color: colors.textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
        letterSpacing: -0.08,
      ),
      labelSmall: TextStyle(
        color: colors.textMuted,
        fontSize: 12,
        fontWeight: FontWeight.w400,
        letterSpacing: 0.05,
        height: 1.2,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.bgMain,
      foregroundColor: colors.textPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      centerTitle: true,
      systemOverlayStyle: isDark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
      titleTextStyle: TextStyle(
        color: colors.textHeading,
        fontSize: 17,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.25,
        fontFamily: '.AppleSystemUIFont',
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: colors.bgSidebar,
      indicatorColor: colors.navActive,
      elevation: 0,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return TextStyle(
            color: colors.textHeading,
            fontSize: 12,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.05,
          );
        }
        return TextStyle(
          color: colors.textMuted,
          fontSize: 12,
          letterSpacing: 0.05,
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return IconThemeData(color: colors.textHeading, size: 22);
        }
        return IconThemeData(color: colors.textMuted, size: 22);
      }),
    ),
    cardTheme: CardThemeData(
      color: colors.cardSurface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.bgInput,
      hintStyle: TextStyle(
        color: colors.textMuted,
        fontSize: 17,
        letterSpacing: -0.2,
      ),
      labelStyle: TextStyle(color: colors.textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide.none,
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: colors.accent, width: 1.5),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: colors.borderSubtle,
      thickness: 0.5,
      space: 0.5,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: colors.textSecondary,
      textColor: colors.textPrimary,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      minVerticalPadding: 12,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return colors.cardSurface;
          }
          return colors.composerPillBg;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return colors.textPrimary;
          }
          return colors.textSecondary;
        }),
        side: WidgetStateProperty.all(BorderSide.none),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.accent,
        foregroundColor: colors.onAccent,
        disabledBackgroundColor: colors.borderStrong,
        disabledForegroundColor: colors.textMuted,
        minimumSize: const Size(0, 50),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.accent,
        backgroundColor: colors.cardSurface,
        disabledForegroundColor: colors.textMuted,
        minimumSize: const Size(0, 50),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: colors.accent,
        textStyle: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w400,
          letterSpacing: -0.2,
        ),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: colors.composerPillBg,
      disabledColor: colors.bgElevated,
      selectedColor: colors.accentSoft,
      labelStyle: TextStyle(color: colors.textSecondary, fontSize: 13),
      secondaryLabelStyle: TextStyle(color: colors.accentText),
      side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: isDark
          ? const Color(0xFF2C2C2E)
          : const Color(0xFF3A3A3C),
      contentTextStyle: const TextStyle(
        color: Color(0xFFFFFFFF),
        fontSize: 15,
        letterSpacing: -0.15,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      behavior: SnackBarBehavior.floating,
      elevation: 0,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: colors.accent,
      linearTrackColor: colors.borderSubtle,
    ),
    iconButtonTheme: IconButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.all(colors.textSecondary),
      ),
    ),
    floatingActionButtonTheme: FloatingActionButtonThemeData(
      backgroundColor: colors.accent,
      foregroundColor: colors.onAccent,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.bgElevated,
      modalBackgroundColor: colors.bgElevated,
      surfaceTintColor: Colors.transparent,
      dragHandleColor: colors.textMuted.withValues(alpha: 0.35),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(14)),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: colors.bgMenu,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shadowColor: colors.shadowScrim.withValues(alpha: 0.18),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      textStyle: TextStyle(
        color: colors.textPrimary,
        fontSize: 17,
        letterSpacing: -0.2,
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.bgElevated,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      titleTextStyle: TextStyle(
        color: colors.textHeading,
        fontSize: 17,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.25,
        fontFamily: '.AppleSystemUIFont',
      ),
      contentTextStyle: TextStyle(
        color: colors.textSecondary,
        fontSize: 13,
        letterSpacing: -0.08,
        height: 1.35,
        fontFamily: '.AppleSystemUIFont',
      ),
    ),
  );
}

/// Secondary filled control — sits on grouped canvas without a hard border.
ButtonStyle ecoTonalButtonStyle(BuildContext context) {
  final colors = ecoColors(context);
  return OutlinedButton.styleFrom(
    foregroundColor: colors.accent,
    backgroundColor: colors.cardSurface,
    side: BorderSide.none,
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    minimumSize: const Size(0, 50),
    padding: const EdgeInsets.symmetric(horizontal: 20),
    textStyle: const TextStyle(
      fontSize: 17,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.2,
    ),
  );
}
