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

  static const dark = EcoColors(
    bgMain: Color(0xFF212121),
    bgSidebar: Color(0xFF1A1A1A),
    bgElevated: Color(0xFF2B2B2B),
    bgElevatedHover: Color(0xFF323232),
    bgInput: Color(0xFF1F1F1F),
    bgOverlay: Color(0x8C000000),
    bgMenu: Color(0xFF242424),
    textPrimary: Color(0xFFE8E8E8),
    textHeading: Color(0xFFF5F5F5),
    textMuted: Color(0xFF8A8A8A),
    textSecondary: Color(0xFFA3A3A3),
    borderSubtle: Color(0xFF383838),
    borderStrong: Color(0xFF404040),
    borderSidebar: Color(0xFF2F2F2F),
    navHover: Color(0x0FFFFFFF),
    navActive: Color(0x1AFFFFFF),
    accent: Color(0xFF3B82F6),
    accentHover: Color(0xFF2563EB),
    accentSoft: Color(0x263B82F6),
    accentText: Color(0xFF93C5FD),
    danger: Color(0xFFF87171),
    dangerSoft: Color(0x1FF87171),
    success: Color(0xFF86EFAC),
    statusAllowBg: Color(0x1A22C55E),
    statusAllowBorder: Color(0x4722C55E),
    statusAllowText: Color(0xFF86EFAC),
    statusDenyBg: Color(0x1AF87171),
    statusDenyBorder: Color(0x47F87171),
    statusDenyText: Color(0xFFFCA5A5),
    statusWarnBg: Color(0x1AF59E0B),
    statusWarnBorder: Color(0x4DF59E0B),
    statusWarnText: Color(0xFFFCD34D),
    cardSurface: Color(0xFF1A1A1A),
    cardSurfaceBorder: Color(0xFF2E2E2E),
    codeBg: Color(0x0FFFFFFF),
    composerContextBg: Color(0xFF303030),
    composerPillBg: Color(0xFF252525),
    composerPillBorder: Color(0xFF343434),
    composerPillText: Color(0xFFA3A3A3),
    composerSendBg: Color(0xFFE8E8E8),
    composerSendText: Color(0xFF1A1A1A),
    composerSendDisabledBg: Color(0xFF3A3A3A),
    composerSendDisabledText: Color(0xFF737373),
    online: Color(0xFF86EFAC),
    offline: Color(0xFF737373),
    assistantBubble: Color(0xFF303030),
    userBubble: Color(0x263B82F6),
    onAccent: Color(0xFFFFFFFF),
    shimmerHighlight: Color(0xFFFFFFFF),
    shadowScrim: Color(0xFF000000),
    statusRunning: Color(0xFF4ADE80),
    statusCompleted: Color(0xFF60A5FA),
    warnAccent: Color(0xFFFBBF24),
    severityHigh: Color(0xFFF97316),
    severityDefault: Color(0xFFFBBF24),
    voiceRecordBg: Color(0xFF1D1D1F),
  );

  static const light = EcoColors(
    bgMain: Color(0xFFFFFFFF),
    bgSidebar: Color(0xFFFCFBFB),
    bgElevated: Color(0xFFFFFFFF),
    bgElevatedHover: Color(0xFFF5F5F7),
    bgInput: Color(0xFFFFFFFF),
    bgOverlay: Color(0x59000000),
    bgMenu: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF1D1D1F),
    textHeading: Color(0xFF1D1D1F),
    textMuted: Color(0xFF86868B),
    textSecondary: Color(0xFF6E6E73),
    borderSubtle: Color(0xFFE5E5EA),
    borderStrong: Color(0xFFD1D1D6),
    borderSidebar: Color(0x14000000),
    navHover: Color(0x0A000000),
    navActive: Color(0x12000000),
    accent: Color(0xFF007AFF),
    accentHover: Color(0xFF0066D6),
    accentSoft: Color(0x1F007AFF),
    accentText: Color(0xFF007AFF),
    danger: Color(0xFFD70015),
    dangerSoft: Color(0x14D70015),
    success: Color(0xFF248A3D),
    statusAllowBg: Color(0x1A248A3D),
    statusAllowBorder: Color(0x47248A3D),
    statusAllowText: Color(0xFF248A3D),
    statusDenyBg: Color(0x14D70015),
    statusDenyBorder: Color(0x47D70015),
    statusDenyText: Color(0xFFD70015),
    statusWarnBg: Color(0x1FFF9500),
    statusWarnBorder: Color(0x59FF9500),
    statusWarnText: Color(0xFFC93400),
    cardSurface: Color(0xFFFFFFFF),
    cardSurfaceBorder: Color(0xFFE5E5EA),
    codeBg: Color(0x0A000000),
    composerContextBg: Color(0xFFF5F5F5),
    composerPillBg: Color(0xFFF0F0F2),
    composerPillBorder: Color(0xFFE5E5EA),
    composerPillText: Color(0xFF6E6E73),
    composerSendBg: Color(0xFF3D3D3D),
    composerSendText: Color(0xFFFFFFFF),
    composerSendDisabledBg: Color(0xFFE5E5EA),
    composerSendDisabledText: Color(0xFFAEAEB2),
    online: Color(0xFF248A3D),
    offline: Color(0xFF86868B),
    assistantBubble: Color(0xFFF5F5F5),
    userBubble: Color(0x1F007AFF),
    onAccent: Color(0xFFFFFFFF),
    shimmerHighlight: Color(0xFFFFFFFF),
    shadowScrim: Color(0xFF000000),
    statusRunning: Color(0xFF248A3D),
    statusCompleted: Color(0xFF007AFF),
    warnAccent: Color(0xFFC93400),
    severityHigh: Color(0xFFD70015),
    severityDefault: Color(0xFFC93400),
    voiceRecordBg: Color(0xFF1D1D1F),
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
      composerSendDisabledBg:
          blend(composerSendDisabledBg, other.composerSendDisabledBg),
      composerSendDisabledText:
          blend(composerSendDisabledText, other.composerSendDisabledText),
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
    textTheme: TextTheme(
      headlineSmall: TextStyle(
        color: colors.textHeading,
        fontWeight: FontWeight.w600,
      ),
      titleMedium: TextStyle(
        color: colors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 15,
      ),
      titleSmall: TextStyle(
        color: colors.textPrimary,
        fontWeight: FontWeight.w600,
        fontSize: 14,
      ),
      bodyLarge: TextStyle(color: colors.textPrimary, fontSize: 14),
      bodyMedium: TextStyle(color: colors.textPrimary, fontSize: 13),
      bodySmall: TextStyle(color: colors.textSecondary, fontSize: 12),
      labelLarge: TextStyle(
        color: colors.textPrimary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
      ),
      labelSmall: TextStyle(color: colors.textMuted, fontSize: 11),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.bgMain,
      foregroundColor: colors.textPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      systemOverlayStyle: isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      titleTextStyle: TextStyle(
        color: colors.textHeading,
        fontSize: 17,
        fontWeight: FontWeight.w600,
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
          );
        }
        return TextStyle(color: colors.textMuted, fontSize: 12);
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return IconThemeData(color: colors.textHeading, size: 22);
        }
        return IconThemeData(color: colors.textMuted, size: 22);
      }),
    ),
    cardTheme: CardThemeData(
      color: colors.bgElevated,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: colors.borderSubtle),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: colors.bgInput,
      hintStyle: TextStyle(color: colors.textMuted),
      labelStyle: TextStyle(color: colors.textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.borderSubtle),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.borderSubtle),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: colors.accent, width: 1.5),
      ),
    ),
    dividerTheme: DividerThemeData(
      color: colors.borderSubtle,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: colors.textSecondary,
      textColor: colors.textPrimary,
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return colors.accent;
          }
          return colors.bgElevated;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return colors.onAccent;
          }
          return colors.textPrimary;
        }),
        side: WidgetStateProperty.all(
          BorderSide(color: colors.borderSubtle),
        ),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: colors.accent,
        foregroundColor: colors.onAccent,
        disabledBackgroundColor: colors.borderStrong,
        disabledForegroundColor: colors.textMuted,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.textPrimary,
        backgroundColor: colors.bgElevated,
        disabledForegroundColor: colors.textMuted,
        minimumSize: const Size(0, 40),
        padding: const EdgeInsets.symmetric(horizontal: 14),
        side: BorderSide(color: colors.borderSubtle),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: colors.composerPillBg,
      disabledColor: colors.bgElevated,
      selectedColor: colors.accentSoft,
      labelStyle: TextStyle(color: colors.textSecondary, fontSize: 12),
      secondaryLabelStyle: TextStyle(color: colors.accentText),
      side: BorderSide(color: colors.composerPillBorder),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: colors.bgMenu,
      contentTextStyle: TextStyle(color: colors.textPrimary),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: colors.borderSubtle),
      ),
      behavior: SnackBarBehavior.floating,
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
      elevation: 2,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.bgElevated,
      modalBackgroundColor: colors.bgElevated,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        side: BorderSide(color: colors.borderSubtle),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: colors.bgMenu,
      surfaceTintColor: Colors.transparent,
      textStyle: TextStyle(color: colors.textPrimary, fontSize: 13),
    ),
  );
}

/// Tonal button matching desktop `.settings-secondary-button`.
ButtonStyle ecoTonalButtonStyle(BuildContext context) {
  final colors = ecoColors(context);
  return OutlinedButton.styleFrom(
    foregroundColor: colors.textPrimary,
    backgroundColor: colors.bgElevated,
    side: BorderSide(color: colors.borderSubtle),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    minimumSize: const Size(0, 40),
    padding: const EdgeInsets.symmetric(horizontal: 14),
    textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
  );
}
