import '../models/acp_models.dart';
import '../../l10n/generated/app_localizations.dart';

/// Vendors used to group Cursor ACP models instead of a flat list.
enum AcpModelVendor { anthropic, gpt, grok, google, other }

const kAcpModelVendors = [
  AcpModelVendor.anthropic,
  AcpModelVendor.gpt,
  AcpModelVendor.grok,
  AcpModelVendor.google,
  AcpModelVendor.other,
];

String _haystack(CursorModelOption model) =>
    '${model.id} ${model.displayName}'.toLowerCase();

/// Classify a Cursor ACP model into a vendor bucket (mirrors the desktop
/// classifier so the mobile picker keeps the provider → model hierarchy).
AcpModelVendor classifyAcpModelVendor(CursorModelOption model) {
  final text = _haystack(model);
  if (RegExp(r'\bgrok\b').hasMatch(text) || text.contains('xai')) {
    return AcpModelVendor.grok;
  }
  if (text.contains('gemini') ||
      text.contains('gemma') ||
      text.contains('google')) {
    return AcpModelVendor.google;
  }
  if (text.contains('claude') ||
      text.contains('anthropic') ||
      text.contains('sonnet') ||
      text.contains('opus') ||
      text.contains('haiku')) {
    return AcpModelVendor.anthropic;
  }
  if (text.contains('gpt') ||
      text.contains('openai') ||
      text.contains('chatgpt') ||
      RegExp(r'(^|[^a-z])o[1-9]([.-]|$)').hasMatch(text)) {
    return AcpModelVendor.gpt;
  }
  return AcpModelVendor.other;
}

Map<AcpModelVendor, List<CursorModelOption>> groupCursorModelsByVendor(
  List<CursorModelOption> models,
) {
  final grouped = {
    for (final vendor in kAcpModelVendors) vendor: <CursorModelOption>[],
  };
  for (final model in models) {
    grouped[classifyAcpModelVendor(model)]?.add(model);
  }
  return grouped;
}

String acpModelVendorLabel(AppLocalizations l10n, AcpModelVendor vendor) {
  switch (vendor) {
    case AcpModelVendor.anthropic:
      return 'Anthropic';
    case AcpModelVendor.gpt:
      return 'GPT';
    case AcpModelVendor.grok:
      return 'Grok';
    case AcpModelVendor.google:
      return 'Google';
    case AcpModelVendor.other:
      return l10n.modelCascadeVendorOther;
  }
}
