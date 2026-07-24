enum AppErrorCode { threadNoPcSelected, threadProjectionNoPcSelected }

class AppErrorCodeException implements Exception {
  const AppErrorCodeException(this.code);

  final AppErrorCode code;

  @override
  String toString() => code.name;
}

const threadNoPcSelectedErrorCode = 'thread.no_pc_selected';
