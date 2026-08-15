class AcpHostUiFeatures {
  const AcpHostUiFeatures({this.contextUsage = 'show', this.billing = 'show'});

  static const showAll = AcpHostUiFeatures();

  final String contextUsage;
  final String billing;

  bool get showContextUsage => contextUsage == 'show';
  bool get showBilling => billing == 'show';

  factory AcpHostUiFeatures.fromJson(Object? json) {
    if (json is! Map) {
      return showAll;
    }
    final map = Map<String, dynamic>.from(json);
    return AcpHostUiFeatures(
      contextUsage: map['contextUsage'] == 'hide' ? 'hide' : 'show',
      billing: map['billing'] == 'hide' ? 'hide' : 'show',
    );
  }
}
