import 'package:flutter/material.dart';

import '../../core/locale/app_localizations_ext.dart';
import '../../l10n/generated/app_localizations.dart';

/// Result of [showUnpairPcPasswordDialog].
///
/// `null` means the user cancelled; otherwise the entered password to verify.
Future<String?> showUnpairPcPasswordDialog(
  BuildContext context, {
  required String desktopName,
  String? initialError,
}) {
  return showDialog<String>(
    context: context,
    barrierDismissible: false,
    builder: (dialogContext) {
      return UnpairPcPasswordDialog(
        desktopName: desktopName,
        initialError: initialError,
      );
    },
  );
}

class UnpairPcPasswordDialog extends StatefulWidget {
  const UnpairPcPasswordDialog({
    super.key,
    required this.desktopName,
    this.initialError,
  });

  final String desktopName;
  final String? initialError;

  @override
  State<UnpairPcPasswordDialog> createState() => _UnpairPcPasswordDialogState();
}

class _UnpairPcPasswordDialogState extends State<UnpairPcPasswordDialog> {
  final _passwordController = TextEditingController();
  final _passwordFocus = FocusNode();
  late String? _errorText = widget.initialError;
  bool _obscure = true;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _passwordFocus.requestFocus();
    });
  }

  @override
  void dispose() {
    _passwordController.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  void _submit(AppLocalizations l10n) {
    if (_submitting) return;
    final password = _passwordController.text;
    if (password.isEmpty) {
      setState(() => _errorText = l10n.setupUnpairPcPasswordRequired);
      return;
    }
    setState(() {
      _submitting = true;
      _errorText = null;
    });
    Navigator.of(context).pop(password);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final scheme = Theme.of(context).colorScheme;
    return AlertDialog(
      title: Text(l10n.setupUnpairPcTitle(widget.desktopName)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.setupUnpairPcMessage),
          const SizedBox(height: 16),
          TextField(
            key: const Key('unpair-pc-password-field'),
            controller: _passwordController,
            focusNode: _passwordFocus,
            obscureText: _obscure,
            enabled: !_submitting,
            autofillHints: const [AutofillHints.password],
            textInputAction: TextInputAction.done,
            onChanged: (_) {
              if (_errorText != null) setState(() => _errorText = null);
            },
            onSubmitted: (_) => _submit(l10n),
            decoration: InputDecoration(
              labelText: l10n.setupPassword,
              hintText: l10n.setupUnpairPcPasswordHint,
              errorText: _errorText,
              suffixIcon: IconButton(
                tooltip: _obscure ? l10n.setupPassword : l10n.setupPassword,
                onPressed: _submitting
                    ? null
                    : () => setState(() => _obscure = !_obscure),
                icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
              ),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          key: const Key('unpair-pc-cancel'),
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: Text(l10n.commonCancel),
        ),
        TextButton(
          key: const Key('unpair-pc-confirm'),
          onPressed: _submitting ? null : () => _submit(l10n),
          style: TextButton.styleFrom(foregroundColor: scheme.error),
          child: Text(l10n.setupUnpairPc),
        ),
      ],
    );
  }
}
