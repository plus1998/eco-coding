class GitWorkingTreeStatus {
  const GitWorkingTreeStatus({
    required this.workspacePath,
    required this.isGitRepository,
    required this.hasGitCommits,
    required this.dirtyFileCount,
    required this.insertions,
    required this.deletions,
    required this.canCommit,
    required this.aheadCount,
    required this.behindCount,
    this.branch,
    this.branches = const [],
    this.remoteOriginUrl,
  });

  factory GitWorkingTreeStatus.fromJson(Map<String, dynamic> json) =>
      GitWorkingTreeStatus(
        workspacePath: json['workspacePath'] as String? ?? '',
        isGitRepository: json['isGitRepository'] as bool? ?? false,
        hasGitCommits: json['hasGitCommits'] as bool? ?? false,
        branch: json['branch'] as String?,
        branches: (json['branches'] as List<dynamic>? ?? [])
            .map((e) => e as String)
            .toList(),
        dirtyFileCount: (json['dirtyFileCount'] as num?)?.toInt() ?? 0,
        insertions: (json['insertions'] as num?)?.toInt() ?? 0,
        deletions: (json['deletions'] as num?)?.toInt() ?? 0,
        canCommit: json['canCommit'] as bool? ?? false,
        aheadCount: (json['aheadCount'] as num?)?.toInt() ?? 0,
        behindCount: (json['behindCount'] as num?)?.toInt() ?? 0,
        remoteOriginUrl: json['remoteOriginUrl'] as String?,
      );

  final String workspacePath;
  final bool isGitRepository;
  final bool hasGitCommits;
  final String? branch;
  final List<String> branches;
  final int dirtyFileCount;
  final int insertions;
  final int deletions;
  final bool canCommit;
  final int aheadCount;
  final int behindCount;
  final String? remoteOriginUrl;
}

class WorkspaceDiffFile {
  const WorkspaceDiffFile({
    required this.path,
    required this.additions,
    required this.deletions,
  });

  factory WorkspaceDiffFile.fromJson(Map<String, dynamic> json) =>
      WorkspaceDiffFile(
        path: json['path'] as String? ?? '',
        additions: (json['additions'] as num?)?.toInt() ?? 0,
        deletions: (json['deletions'] as num?)?.toInt() ?? 0,
      );

  final String path;
  final int additions;
  final int deletions;
}

class WorkspaceDiffResult {
  const WorkspaceDiffResult({
    required this.workspacePath,
    required this.fileCount,
    required this.files,
    required this.totalAdditions,
    required this.totalDeletions,
    this.patch = '',
    this.patchTruncated = false,
  });

  factory WorkspaceDiffResult.fromJson(Map<String, dynamic> json) =>
      WorkspaceDiffResult(
        workspacePath: json['workspacePath'] as String? ?? '',
        patch: json['patch'] as String? ?? '',
        patchTruncated: json['patchTruncated'] as bool? ?? false,
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        files: (json['files'] as List<dynamic>? ?? [])
            .map((e) => WorkspaceDiffFile.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalAdditions: (json['totalAdditions'] as num?)?.toInt() ?? 0,
        totalDeletions: (json['totalDeletions'] as num?)?.toInt() ?? 0,
      );

  final String workspacePath;
  final String patch;
  final bool patchTruncated;
  final int fileCount;
  final List<WorkspaceDiffFile> files;
  final int totalAdditions;
  final int totalDeletions;

  bool get hasChanges => fileCount > 0;
}

class GitGenerateCommitMessageResult {
  const GitGenerateCommitMessageResult({
    required this.message,
    required this.role,
    required this.modelId,
    required this.providerName,
  });

  factory GitGenerateCommitMessageResult.fromJson(Map<String, dynamic> json) =>
      GitGenerateCommitMessageResult(
        message: json['message'] as String? ?? '',
        role: json['role'] as String? ?? '',
        modelId: json['modelId'] as String? ?? '',
        providerName: json['providerName'] as String? ?? '',
      );

  final String message;
  final String role;
  final String modelId;
  final String providerName;
}

class GitCommitResult {
  const GitCommitResult({
    required this.commitSha,
    required this.message,
    required this.generated,
    this.role,
    this.modelId,
  });

  factory GitCommitResult.fromJson(Map<String, dynamic> json) => GitCommitResult(
        commitSha: json['commitSha'] as String? ?? '',
        message: json['message'] as String? ?? '',
        generated: json['generated'] as bool? ?? false,
        role: json['role'] as String?,
        modelId: json['modelId'] as String?,
      );

  final String commitSha;
  final String message;
  final bool generated;
  final String? role;
  final String? modelId;
}

class GitPushResult {
  const GitPushResult({
    required this.method,
    required this.output,
  });

  factory GitPushResult.fromJson(Map<String, dynamic> json) => GitPushResult(
        method: json['method'] as String? ?? 'git',
        output: json['output'] as String? ?? '',
      );

  final String method;
  final String output;
}
