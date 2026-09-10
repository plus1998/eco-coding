class HtmlHostArtifact {
  const HtmlHostArtifact({
    required this.id,
    required this.threadId,
    required this.status,
    required this.pageId,
    required this.slug,
    required this.title,
    required this.publicUrl,
    required this.expiresAt,
    required this.canExtend,
    required this.createdAt,
    required this.updatedAt,
    this.toolUseId,
    this.extendedAt,
  });

  final String id;
  final String threadId;
  final String? toolUseId;
  final String status;
  final String pageId;
  final String slug;
  final String title;
  final String publicUrl;
  final String expiresAt;
  final String? extendedAt;
  final bool canExtend;
  final String createdAt;
  final String updatedAt;

  factory HtmlHostArtifact.fromJson(Map<String, dynamic> json) {
    final id = (json['id'] as String?)?.trim() ?? '';
    final threadId = (json['threadId'] as String?)?.trim() ?? '';
    final status = (json['status'] as String?)?.trim() ?? 'completed';
    final pageId = (json['pageId'] as String?)?.trim() ?? '';
    final slug = (json['slug'] as String?)?.trim() ?? '';
    final title = (json['title'] as String?)?.trim() ?? '';
    final publicUrl = (json['publicUrl'] as String?)?.trim() ?? '';
    final expiresAt = (json['expiresAt'] as String?)?.trim() ?? '';
    final createdAt = (json['createdAt'] as String?)?.trim() ?? '';
    final updatedAt = (json['updatedAt'] as String?)?.trim() ?? '';
    final toolUseId = (json['toolUseId'] as String?)?.trim();
    final extendedAt = (json['extendedAt'] as String?)?.trim();
    final canExtend = json['canExtend'];
    return HtmlHostArtifact(
      id: id,
      threadId: threadId,
      toolUseId: toolUseId?.isNotEmpty == true ? toolUseId : null,
      status: status.isEmpty ? 'completed' : status,
      pageId: pageId,
      slug: slug,
      title: title,
      publicUrl: publicUrl,
      expiresAt: expiresAt,
      extendedAt: extendedAt?.isNotEmpty == true ? extendedAt : null,
      canExtend: canExtend is bool ? canExtend : false,
      createdAt: createdAt,
      updatedAt: updatedAt,
    );
  }

  String get displayTitle {
    final named = title.trim();
    if (named.isNotEmpty) return named;
    final url = publicUrl.trim();
    if (url.isNotEmpty) return url;
    return id;
  }
}
