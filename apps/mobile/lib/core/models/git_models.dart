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
    required this.hasUpstream,
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
        hasUpstream: json['hasUpstream'] as bool? ?? false,
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
  final bool hasUpstream;
  final String? remoteOriginUrl;

  bool get hasChanges => dirtyFileCount > 0;

  WorkspaceChangesSummary toChangesSummary() => WorkspaceChangesSummary(
        fileCount: dirtyFileCount,
        totalAdditions: insertions,
        totalDeletions: deletions,
      );
}

class WorkspaceChangesSummary {
  const WorkspaceChangesSummary({
    required this.fileCount,
    required this.totalAdditions,
    required this.totalDeletions,
  });

  factory WorkspaceChangesSummary.fromDiff(WorkspaceDiffResult diff) =>
      WorkspaceChangesSummary(
        fileCount: diff.fileCount,
        totalAdditions: diff.totalAdditions,
        totalDeletions: diff.totalDeletions,
      );

  final int fileCount;
  final int totalAdditions;
  final int totalDeletions;

  bool get hasChanges => fileCount > 0;
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
    required this.candidateModelId,
    required this.modelId,
    required this.providerName,
    this.role,
  });

  factory GitGenerateCommitMessageResult.fromJson(Map<String, dynamic> json) =>
      GitGenerateCommitMessageResult(
        message: json['message'] as String? ?? '',
        candidateModelId: json['candidateModelId'] as String? ?? '',
        modelId: json['modelId'] as String? ?? '',
        providerName: json['providerName'] as String? ?? '',
        role: json['role'] as String?,
      );

  final String message;
  final String candidateModelId;
  final String modelId;
  final String providerName;
  final String? role;
}

class CommitModelPricingHint {
  const CommitModelPricingHint({
    required this.candidateModelId,
    required this.modelId,
    required this.providerName,
    required this.pricingResolved,
    this.pricingLabel,
    this.inputPerM,
    this.outputPerM,
  });

  factory CommitModelPricingHint.fromJson(Map<String, dynamic> json) =>
      CommitModelPricingHint(
        candidateModelId: json['candidateModelId'] as String? ?? '',
        modelId: json['modelId'] as String? ?? '',
        providerName: json['providerName'] as String? ?? '',
        pricingResolved: json['pricingResolved'] as bool? ?? false,
        pricingLabel: json['pricingLabel'] as String?,
        inputPerM: (json['rates'] as Map<String, dynamic>?)?['inputPerM'] as num?,
        outputPerM: (json['rates'] as Map<String, dynamic>?)?['outputPerM'] as num?,
      );

  final String candidateModelId;
  final String modelId;
  final String providerName;
  final bool pricingResolved;
  final String? pricingLabel;
  final num? inputPerM;
  final num? outputPerM;
}

class CommitModelOptionView {
  const CommitModelOptionView({
    required this.id,
    required this.candidateModelId,
    required this.providerId,
    required this.providerName,
    required this.modelId,
    required this.modelLabel,
    required this.providerColor,
    this.hint,
  });

  factory CommitModelOptionView.fromJson(Map<String, dynamic> json) =>
      CommitModelOptionView(
        id: json['id'] as String? ?? '',
        candidateModelId: json['candidateModelId'] as String? ?? '',
        providerId: json['providerId'] as String? ?? '',
        providerName: json['providerName'] as String? ?? '',
        modelId: json['modelId'] as String? ?? '',
        modelLabel: json['modelLabel'] as String? ?? '',
        providerColor: json['providerColor'] as String? ?? '',
        hint: json['hint'] == null
            ? null
            : CommitModelPricingHint.fromJson(json['hint'] as Map<String, dynamic>),
      );

  final String id;
  final String candidateModelId;
  final String providerId;
  final String providerName;
  final String modelId;
  final String modelLabel;
  final String providerColor;
  final CommitModelPricingHint? hint;
}

class GitListCommitModelOptionsResult {
  const GitListCommitModelOptionsResult({
    required this.options,
    required this.savedCandidateModelId,
  });

  factory GitListCommitModelOptionsResult.fromJson(Map<String, dynamic> json) =>
      GitListCommitModelOptionsResult(
        options: (json['options'] as List<dynamic>? ?? [])
            .map((entry) => CommitModelOptionView.fromJson(entry as Map<String, dynamic>))
            .toList(),
        savedCandidateModelId: json['savedCandidateModelId'] as String? ?? 'auto',
      );

  final List<CommitModelOptionView> options;
  final String savedCandidateModelId;
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

class GitPullResult {
  const GitPullResult({
    required this.output,
    required this.pulled,
    required this.conflicted,
    this.conflictFiles = const [],
  });

  factory GitPullResult.fromJson(Map<String, dynamic> json) => GitPullResult(
        output: json['output'] as String? ?? '',
        pulled: json['pulled'] as bool? ?? false,
        conflicted: json['conflicted'] as bool? ?? false,
        conflictFiles: (json['conflictFiles'] as List<dynamic>? ?? [])
            .map((entry) => entry as String)
            .toList(),
      );

  final String output;
  final bool pulled;
  final bool conflicted;
  final List<String> conflictFiles;
}

class PackageScriptInfo {
  const PackageScriptInfo({
    required this.name,
    required this.command,
  });

  factory PackageScriptInfo.fromJson(Map<String, dynamic> json) =>
      PackageScriptInfo(
        name: json['name'] as String? ?? '',
        command: json['command'] as String? ?? '',
      );

  final String name;
  final String command;
}

class PackageScriptsListResult {
  const PackageScriptsListResult({
    required this.workspacePath,
    required this.hasPackageJson,
    required this.packageManager,
    required this.scripts,
    this.packageName,
  });

  factory PackageScriptsListResult.fromJson(Map<String, dynamic> json) =>
      PackageScriptsListResult(
        workspacePath: json['workspacePath'] as String? ?? '',
        hasPackageJson: json['hasPackageJson'] as bool? ?? false,
        packageName: json['packageName'] as String?,
        packageManager: json['packageManager'] as String? ?? 'npm',
        scripts: (json['scripts'] as List<dynamic>? ?? [])
            .map((entry) => PackageScriptInfo.fromJson(entry as Map<String, dynamic>))
            .toList(),
      );

  final String workspacePath;
  final bool hasPackageJson;
  final String? packageName;
  final String packageManager;
  final List<PackageScriptInfo> scripts;
}

class StartPackageScriptResult {
  const StartPackageScriptResult({
    required this.script,
    required this.command,
    required this.sessionId,
  });

  factory StartPackageScriptResult.fromJson(Map<String, dynamic> json) =>
      StartPackageScriptResult(
        sessionId: json['sessionId'] as String? ?? '',
        script: json['script'] as String? ?? '',
        command: (json['command'] as List<dynamic>? ?? [])
            .map((entry) => entry as String)
            .toList(),
      );

  final String sessionId;
  final String script;
  final List<String> command;
}
