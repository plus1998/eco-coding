// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'Eco';

  @override
  String get navSessions => 'Sessions';

  @override
  String get navSettings => 'Settings';

  @override
  String get connectionReconnecting => 'Reconnecting to Center Server...';

  @override
  String get connectionConnected => 'Connected';

  @override
  String get connectionLostReconnecting => 'Connection lost. Reconnecting...';

  @override
  String get connectionLiveChannelDisconnected =>
      'Live connection disconnected';

  @override
  String get settingsTitle => 'Settings';

  @override
  String get settingsNotSignedIn => 'Not signed in';

  @override
  String get settingsConnectPcFirst => 'Connect a PC first';

  @override
  String get settingsAppearance => 'Appearance';

  @override
  String get settingsTheme => 'Theme';

  @override
  String get settingsLanguage => 'Language';

  @override
  String get settingsLanguageSystem => 'System';

  @override
  String get settingsLanguageChinese => 'Chinese';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsThemeSystem => 'System';

  @override
  String get settingsThemeDark => 'Dark';

  @override
  String get settingsThemeLight => 'Light';

  @override
  String get settingsDefaultMode => 'Default mode';

  @override
  String get settingsDefaultModeCaption => 'Composer mode for new sessions';

  @override
  String get settingsAccount => 'Account';

  @override
  String get settingsSwitchPc => 'Switch PC';

  @override
  String get settingsSwitchPcSubtitle =>
      'Select or pair another Desktop device';

  @override
  String get settingsSignOut => 'Sign out';

  @override
  String get settingsSignedOut => 'Signed out';

  @override
  String get sessionModeAgentDescription =>
      'Handle tasks directly and call enabled subagents when needed.';

  @override
  String get sessionModePlanDescription =>
      'Create a plan and wait for approval before executing it.';

  @override
  String get sessionModeAskDescription =>
      'Answer and explore code without changing files or running commands.';

  @override
  String get relativeTimeJustNow => 'Just now';

  @override
  String relativeTimeMinutes(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutes',
      one: '1 minute',
    );
    return '$_temp0';
  }

  @override
  String relativeTimeHours(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count hours',
      one: '1 hour',
    );
    return '$_temp0';
  }

  @override
  String relativeTimeDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days',
      one: '1 day',
    );
    return '$_temp0';
  }

  @override
  String relativeTimeWeeks(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count weeks',
      one: '1 week',
    );
    return '$_temp0';
  }

  @override
  String relativeTimeMonths(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count months',
      one: '1 month',
    );
    return '$_temp0';
  }

  @override
  String relativeTimeYears(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count years',
      one: '1 year',
    );
    return '$_temp0';
  }

  @override
  String get commonCancel => 'Cancel';

  @override
  String get commonClose => 'Close';

  @override
  String get commonRetry => 'Retry';

  @override
  String get commonSubmit => 'Submit';

  @override
  String get commonProcessing => 'Processing...';

  @override
  String get commonExpand => 'Expand';

  @override
  String get commonCollapse => 'Collapse';

  @override
  String get commonBack => 'Back';

  @override
  String get commonRefresh => 'Refresh status';

  @override
  String get commonDelete => 'Delete';

  @override
  String get commonEnable => 'Enable';

  @override
  String get commonEnabled => 'Enabled';

  @override
  String get commonDisabled => 'Disabled';

  @override
  String get commonNotConfigured => 'Not configured';

  @override
  String get commonUnavailable => 'Unavailable';

  @override
  String get commonLoading => 'Loading...';

  @override
  String get commonOnline => 'Online';

  @override
  String get commonOffline => 'Offline';

  @override
  String get commonChecking => 'Checking';

  @override
  String get commonNotSelected => 'Not selected';

  @override
  String get toolbarSearch => 'Search sessions and projects';

  @override
  String get toolbarOpenProject => 'Open project';

  @override
  String get toolbarSwitchPc => 'Switch PC';

  @override
  String get threadsTitle => 'Sessions';

  @override
  String get threadNew => 'New session';

  @override
  String get threadMore => 'More';

  @override
  String get threadBackToBottom => 'Back to bottom';

  @override
  String get threadWorkspaceCopied => 'Working directory copied';

  @override
  String get threadNoSessions => 'No sessions';

  @override
  String get threadSearchHint => 'Search session titles or projects';

  @override
  String get threadSearchClear => 'Clear';

  @override
  String get threadSearchRunning => 'Running';

  @override
  String get threadSearchSessions => 'Sessions';

  @override
  String get threadSearchProjects => 'Projects';

  @override
  String get threadSearchNoResults => 'No matching sessions or projects';

  @override
  String get projectFallbackName => 'Project';

  @override
  String get projectNoProjects => 'No projects yet';

  @override
  String get projectNoProjectsHint =>
      'Open a project from the top right and enter a path on Desktop to begin.';

  @override
  String get projectOpen => 'Open project';

  @override
  String get projectOpening => 'Reading Desktop folders...';

  @override
  String get projectOpenCurrentFolder => 'Open current folder';

  @override
  String get projectNoSubfolders => 'This folder has no subfolders';

  @override
  String get projectParentFolder => 'Parent folder';

  @override
  String get projectOpened => 'Project opened';

  @override
  String get projectPin => 'Pin';

  @override
  String get projectUnpin => 'Unpin';

  @override
  String get projectRemove => 'Remove project';

  @override
  String get projectNoPcSelected => 'No PC selected';

  @override
  String get approvalReject => 'Reject';

  @override
  String get approvalApprove => 'Approve';

  @override
  String get approvalApproveExecution => 'Approve execution';

  @override
  String get approvalPlanTitle => 'Plan approval';

  @override
  String get approvalUserRequest => 'User request';

  @override
  String get approvalAnalysis => 'Analysis';

  @override
  String get approvalPlan => 'Plan';

  @override
  String get approvalToolReadTitle => 'Tool read approval';

  @override
  String get approvalBashTitle => 'Bash execution approval';

  @override
  String get approvalNeedsClarification => 'Clarification needed';

  @override
  String get approvalClarificationPrevious => 'Previous question';

  @override
  String get approvalClarificationNext => 'Next question';

  @override
  String get approvalClarificationRecommended => 'Recommended';

  @override
  String get approvalClarificationCompleteSelection => 'Complete selection';

  @override
  String get approvalSeverityCritical => 'Critical';

  @override
  String get approvalSeverityHigh => 'High';

  @override
  String get approvalSeverityMedium => 'Medium';

  @override
  String get approvalSeverityLow => 'Low';

  @override
  String get approvalSkip => 'Skip';

  @override
  String get approvalYes => 'Yes';

  @override
  String get approvalImplementPlan => 'Implementation plan';

  @override
  String get approvalLastRunFailed => 'Last run failed';

  @override
  String get approvalIgnore => 'Ignore';

  @override
  String get approvalExecutePlan => 'Execute plan ↵';

  @override
  String get approvalSubmitEnter => 'Submit ↵';

  @override
  String get composerAddImage => 'Add image';

  @override
  String get composerVoiceInput => 'Voice input';

  @override
  String get composerStopVoiceInput => 'Stop voice input';

  @override
  String get composerNoSpeech => 'No speech recognized';

  @override
  String get composerSendHint => 'Send a message...';

  @override
  String get composerFollowUp => 'Follow up';

  @override
  String get composerRequestChanges => 'Request changes';

  @override
  String composerPendingImage(int index) {
    return 'Pending image $index';
  }

  @override
  String composerRemoveImage(int index) {
    return 'Remove image $index';
  }

  @override
  String get voiceListening => 'Listening';

  @override
  String get voiceTapToStop => 'Tap anywhere when you are done';

  @override
  String get voiceStop => 'Stop';

  @override
  String get setupConnectPc => 'Connect PC';

  @override
  String get setupPrevious => 'Previous';

  @override
  String get setupNext => 'Next';

  @override
  String get setupEnterApp => 'Enter app';

  @override
  String get setupTestConnection => 'Test connection';

  @override
  String get setupRetestConnection => 'Test again';

  @override
  String get setupConnectionError => 'Connection error';

  @override
  String get setupRetryConnection => 'Retry connection';

  @override
  String get setupCompleteServerFirst => 'Configure the server first';

  @override
  String get setupLogin => 'Sign in';

  @override
  String get setupRegister => 'Register';

  @override
  String get setupEmail => 'Email';

  @override
  String get setupPassword => 'Password';

  @override
  String get setupRegisterAndLogin => 'Register and sign in';

  @override
  String get setupPairingCode => 'Pairing code';

  @override
  String get setupPairingCodeHint => '8 characters';

  @override
  String get setupScan => 'Scan';

  @override
  String get setupBind => 'Pair';

  @override
  String get setupCompleteLoginFirst => 'Sign in first';

  @override
  String get setupBindPcFirst => 'Pair a PC first';

  @override
  String get setupNoBoundDevices => 'No paired devices';

  @override
  String get setupScanPcCode => 'Scan the PC pairing code';

  @override
  String get setupScanPcCodeHint =>
      'Generate a QR code from Connect on Desktop';

  @override
  String get setupManualConfiguration => 'Manual setup';

  @override
  String get setupSelectPc => 'Select PC';

  @override
  String get setupSelectPcHint =>
      'Select a Desktop to enter the app, or scan to pair a new device.';

  @override
  String get setupCurrent => 'Current';

  @override
  String get setupBound => 'Paired';

  @override
  String get setupSelectOnlinePcFirst =>
      'Select an online PC before entering the app';

  @override
  String get setupBindNewPc => 'Pair new PC';

  @override
  String get pairingScanTitle => 'Scan pairing code';

  @override
  String get pairingScanHint =>
      'Place the QR code from Connect on Desktop inside the frame';

  @override
  String get pairingTorchOn => 'Turn flashlight on';

  @override
  String get pairingTorchOff => 'Turn flashlight off';

  @override
  String get setupWizardServerTitle => 'Configure server';

  @override
  String get setupWizardLoginTitle => 'Register / Sign in';

  @override
  String get setupWizardBindTitle => 'Pair PC';

  @override
  String get setupWizardSelectTitle => 'Select PC';

  @override
  String get setupWizardServerSubtitle =>
      'Enter the Center Server address and verify connectivity';

  @override
  String get setupWizardLoginSubtitle =>
      'Sign in and register this phone as a mobile device';

  @override
  String get setupWizardBindSubtitle =>
      'Generate a pairing code on Desktop, then scan or enter it';

  @override
  String get setupWizardSelectSubtitle =>
      'Select the PC you want to control remotely';

  @override
  String get setupWizardServerShort => 'Server';

  @override
  String get setupWizardAccountShort => 'Account';

  @override
  String get setupWizardPairShort => 'Pair';

  @override
  String get setupStatusServerReachable => 'Server reachable';

  @override
  String get setupStatusServerHelp =>
      'Check the address, Wi-Fi, and whether Server listens on 0.0.0.0';

  @override
  String get setupStatusAccountDevice => 'Account and mobile device';

  @override
  String get setupStatusRegisteringDevice => 'Registering this device...';

  @override
  String get setupStatusLiveChannel => 'Live channel (WebSocket)';

  @override
  String get setupStatusCenterConnected => 'Connected to Center Server';

  @override
  String get setupStatusConnecting => 'Connecting...';

  @override
  String get setupStatusPairPc => 'Pair PC';

  @override
  String setupStatusBoundCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count paired PCs',
      one: '1 paired PC',
    );
    return '$_temp0';
  }

  @override
  String get setupStatusPairHint =>
      'Generate a pairing code on Desktop, then scan or enter it';

  @override
  String get setupStatusSelectControlledPc => 'Select PC to control';

  @override
  String setupStatusCheckingDevice(Object name) {
    return '$name · Checking...';
  }

  @override
  String setupStatusDeviceOnline(Object name) {
    return '$name · Online';
  }

  @override
  String setupStatusDeviceOffline(Object name) {
    return '$name · Offline';
  }

  @override
  String get setupStatusDesktopOfflineHelp =>
      'Desktop is offline. Confirm it is connected to the same Server.';

  @override
  String get setupStatusWebSocketDisconnected =>
      'WebSocket is disconnected. Sign in again or pull to refresh.';

  @override
  String get setupProgressTitle => 'Connection progress';

  @override
  String get setupConnectedReady => 'Connected. Select a PC to continue.';

  @override
  String setupOpenedDevice(Object name) {
    return 'Opened $name';
  }

  @override
  String setupBoundDevice(Object name) {
    return 'Paired $name';
  }

  @override
  String setupSelectedDevice(Object name) {
    return 'Selected $name';
  }

  @override
  String setupSelectedDeviceOffline(Object name) {
    return '$name was selected but is currently offline';
  }

  @override
  String setupDeviceOfflineServerHelp(Object name) {
    return '$name is offline. Confirm Desktop is connected to Server.';
  }

  @override
  String setupBoundDeviceOffline(Object name) {
    return '$name was paired but is currently offline';
  }

  @override
  String get setupLegacyQr => 'Legacy QR code. Sign in before pairing.';

  @override
  String get setupServerReachable => 'Server is reachable';

  @override
  String get setupServerUnreachable =>
      'Cannot reach the server. Check the address and network.';

  @override
  String get setupServerRequired => 'Configure the server first';

  @override
  String get setupLoginSuccess => 'Signed in. WebSocket connected.';

  @override
  String get setupReconnectAttempted => 'Tried reconnecting WebSocket';

  @override
  String get setupBoundPcFallback => 'Paired PC';

  @override
  String get composerWorkMode => 'Work mode';

  @override
  String get composerWorkModeSubtitle => 'Choose how this session runs';

  @override
  String get composerMode => 'Mode';

  @override
  String get composerBashApproval => 'Bash approval';

  @override
  String get composerBashApprovalSubtitle =>
      'Control confirmation before commands run';

  @override
  String get bashReviewAlways => 'Always confirm';

  @override
  String get bashReviewAlwaysDescription =>
      'Ask before running commands or accessing paths outside the workspace';

  @override
  String get bashReviewAuto => 'Confirm risky actions';

  @override
  String get bashReviewAutoDescription =>
      'Run low-risk actions automatically; still ask for risky commands or external paths';

  @override
  String get bashReviewAllowAll => 'Run automatically';

  @override
  String get bashReviewAllowAllDescription =>
      'Skip confirmations while respecting the current mode, orchestration, and security policy';

  @override
  String get composerSettings => 'Composer settings';

  @override
  String get composerOrchestrationSelection => 'Orchestration';

  @override
  String activityToolIncomplete(Object text) {
    return 'Tool incomplete · $text';
  }

  @override
  String activityReadFiles(Object count) {
    return 'Read $count files';
  }

  @override
  String activityWroteFiles(Object count) {
    return 'Wrote $count files';
  }

  @override
  String activityEditedFiles(Object count) {
    return 'Edited $count files';
  }

  @override
  String get activitySearchedCode => 'Searched code';

  @override
  String activitySearchedCodeTimes(Object count) {
    return 'Searched code $count times';
  }

  @override
  String activityRanCommands(Object count) {
    return 'Ran $count commands';
  }

  @override
  String activityCalledSubagents(Object count) {
    return 'Called $count subagents';
  }

  @override
  String activityRanTools(Object count) {
    return 'Ran $count tools';
  }

  @override
  String get activityCreatingTask => 'Creating task';

  @override
  String get activityCreatedTask => 'Created task';

  @override
  String get activityUpdatingTask => 'Updating task';

  @override
  String get activityUpdatedTask => 'Updated task';

  @override
  String get activityWriting => 'Writing';

  @override
  String get activityWrote => 'Wrote';

  @override
  String get activityEditing => 'Editing';

  @override
  String get activityEdited => 'Edited';

  @override
  String get activityReading => 'Reading';

  @override
  String get activityRead => 'Read';

  @override
  String get activitySearching => 'Searching';

  @override
  String get activitySearched => 'Searched';

  @override
  String get activityRunning => 'Running';

  @override
  String get activityRan => 'Ran';

  @override
  String get activityCallingSubagent => 'Calling subagent';

  @override
  String get activityCalledSubagent => 'Called subagent';

  @override
  String get activityExecuting => 'Executing';

  @override
  String get activityExecuted => 'Executed';

  @override
  String activityListPair(Object first, Object second) {
    return '$first and $second';
  }

  @override
  String activityListEnd(Object head, Object last) {
    return '$head, and $last';
  }

  @override
  String get activityProcessing => 'Processing';

  @override
  String get activityProcessed => 'Processed';

  @override
  String get activityExecutionProcess => 'Execution process';

  @override
  String get activityExecutionResult => 'Execution result';

  @override
  String get activityFinalOutput => 'Final output';

  @override
  String get activityExpandFull => 'Show all';

  @override
  String get activityClarificationAnswer => 'Clarification answer';

  @override
  String get activityNoneSelected => '(Not selected)';

  @override
  String get activityThinking => 'Thinking';

  @override
  String activityRunFailed(Object suffix) {
    return 'Run failed$suffix';
  }

  @override
  String activityRunningSuffix(Object suffix) {
    return 'Running$suffix';
  }

  @override
  String activityRanSuffix(Object suffix) {
    return 'Ran$suffix';
  }

  @override
  String get activityFailed => 'Failed';

  @override
  String activitySubagentTask(Object title) {
    return '$title subagent task';
  }

  @override
  String get activityTaskGoal => 'Task goal';

  @override
  String get activityWaitingMission => 'Waiting for task instructions...';

  @override
  String get activityWaitingEvents => 'Waiting for execution events...';

  @override
  String get activityWorking => 'Working';

  @override
  String get activityCompressingContext => 'Compressing context automatically';

  @override
  String get activityContextCompressed => 'Context compressed automatically';

  @override
  String get activityContextCompressionFailed => 'Context compression failed';

  @override
  String get activityContextCompressionPaused =>
      'Automatic context compression paused';

  @override
  String get activityPromptCacheDrop =>
      'Prompt cache hit rate dropped significantly';

  @override
  String get activityPreparingRetry => 'Preparing to retry';

  @override
  String get activityRunDiagnostics => 'Run diagnostics';

  @override
  String activityAllowOutsideWorkspace(Object tool) {
    return 'Allow $tool outside the workspace?';
  }

  @override
  String get activityToolPermissionRequired => 'Tool permission required';

  @override
  String get activityReadSkill => 'Read skill';

  @override
  String get activityStartSubagent => 'Start subagent';

  @override
  String get activityConnectionFailed => 'Connection failed';

  @override
  String activityConnectionFailedHttp(Object status) {
    return 'Connection failed · HTTP $status';
  }

  @override
  String activityReconnectAttempt(Object attempt, Object max) {
    return 'Reconnect $attempt/$max';
  }

  @override
  String get roleVision => 'Vision';

  @override
  String get roleExplore => 'Explore';

  @override
  String get roleArchitect => 'Architect';

  @override
  String get roleCoder => 'Coder';

  @override
  String get roleReviewer => 'Reviewer';

  @override
  String get roleTester => 'Tester';

  @override
  String get toolRead => 'Read';

  @override
  String get toolWrite => 'Write';

  @override
  String get toolEdit => 'Edit';

  @override
  String get toolSearch => 'Search';

  @override
  String get toolFind => 'Find';

  @override
  String get toolRunCommand => 'Run command';

  @override
  String get toolCall => 'Call';

  @override
  String get toolUpdateTasks => 'Update tasks';

  @override
  String get toolCreateTask => 'Create task';

  @override
  String get toolListTasks => 'List tasks';

  @override
  String get toolReadTaskOutput => 'Read task output';

  @override
  String get toolClarify => 'Clarify';

  @override
  String get toolWebSearch => 'Search web';

  @override
  String get toolWebFetch => 'Fetch web page';

  @override
  String get threadTasks => 'Task progress';

  @override
  String get threadCodeReview => 'Code review';

  @override
  String get threadCommitPush => 'Commit and push';

  @override
  String get threadStartFirstForTasks =>
      'Start the session before viewing task progress';

  @override
  String get threadSelectOrchestrationFirst =>
      'Select an orchestration in Composer settings first';

  @override
  String get threadLoadingCommit => 'Loading commit information...';

  @override
  String get threadCommittedPushed => 'Committed and pushed to remote';

  @override
  String get threadPushed => 'Pushed to remote';

  @override
  String get threadCommitted => 'Committed';

  @override
  String threadPullBehind(Object count) {
    return 'Pull ($count behind)';
  }

  @override
  String get threadFetch => 'Fetch';

  @override
  String get threadPulling => 'Pulling...';

  @override
  String get threadPullConflictDesktop =>
      'Pull conflict. Resolve it on Desktop.';

  @override
  String threadPullConflictFiles(Object files) {
    return 'Pull conflicts: $files';
  }

  @override
  String get threadPullSuccess => 'Pulled successfully';

  @override
  String get threadAlreadySynced => 'The current branch is up to date';

  @override
  String get threadFetching => 'Fetching...';

  @override
  String get threadFetchComplete => 'Fetch complete';

  @override
  String get threadTaskListEmpty => 'No task list';

  @override
  String get threadTaskInProgress => 'In progress';

  @override
  String get threadTaskCompleted => 'Completed';

  @override
  String get threadTaskBlocked => 'Blocked';

  @override
  String get threadTaskStopped => 'Stopped';

  @override
  String get threadTaskPending => 'Pending';

  @override
  String get threadDesktopDisconnected => 'Desktop is not connected';

  @override
  String get threadNpmScriptsEmpty => 'No package.json scripts found';

  @override
  String get threadNpmScriptsSearchHint => 'Search scripts';

  @override
  String get threadNpmScriptsNoMatches => 'No matching scripts';

  @override
  String get threadExtraArgs => 'Extra arguments';

  @override
  String threadExtraArgsValue(Object args) {
    return 'Extra arguments: $args';
  }

  @override
  String get threadRun => 'Run';

  @override
  String get threadRunStarting => 'Starting';

  @override
  String get threadRunRunning => 'Running';

  @override
  String get threadRunCompleted => 'Completed';

  @override
  String get threadRunFailed => 'Failed';

  @override
  String get threadRunStopped => 'Stopped';

  @override
  String get threadStopping => 'Stopping';

  @override
  String get threadStop => 'Stop';

  @override
  String get threadWaitingCommandOutput =>
      'Waiting for command output from Desktop...';

  @override
  String get threadOutputTruncated =>
      'Output is too long. Only the latest content is shown.';

  @override
  String get threadDelete => 'Delete session';

  @override
  String threadDeleteConfirm(Object title) {
    return 'Delete “$title”? This cannot be undone.';
  }

  @override
  String get threadDeleted => 'Session deleted';

  @override
  String get threadEditGuidanceHint => 'Edit guidance message...';

  @override
  String get threadProjectionLoading => 'Loading run projection...';

  @override
  String get threadProjectionUnavailable => 'Run projection is not ready';

  @override
  String get threadNoSubagentDetails => 'No subagent details';

  @override
  String get threadNoToolDetails => 'No tool details';

  @override
  String get threadRequestingDetails => 'Requesting details...';

  @override
  String get threadDetailsFailed => 'Details request failed';

  @override
  String get threadNoDetailsResponse => 'No details response received';

  @override
  String get threadZeroDetails => 'Desktop returned 0 detail records';

  @override
  String get threadDetailsUnparseable =>
      'The request was sent, but no parseable detail result was received.';

  @override
  String threadDetailsComplete(Object key, Object kind) {
    return 'Request completed, kind=$kind, key=$key.';
  }

  @override
  String get threadEditingGuidance => 'Editing guidance message';

  @override
  String get billingTitle => 'Billing';

  @override
  String get billingSessionTotal =>
      'Session total · Cost after Eco orchestration';

  @override
  String get billingComparison => 'Cost comparison';

  @override
  String get billingUnorchestrated => 'Unorchestrated';

  @override
  String billingPlannerEstimate(Object model) {
    return 'Estimated at $model rates';
  }

  @override
  String get billingMainModelEstimate => 'Estimated at main model rates';

  @override
  String get billingEco => 'Eco coding';

  @override
  String get billingEcoSubtitle => 'Actual cost after Eco orchestration';

  @override
  String get billingSavings => 'Savings';

  @override
  String get billingTokenUsage => 'Token usage';

  @override
  String get billingInput => 'Input';

  @override
  String get billingOutput => 'Output';

  @override
  String get billingCacheHitRate => 'Cache hit rate';

  @override
  String get billingCacheRead => 'Cache read';

  @override
  String get billingCacheWrite => 'Cache write';

  @override
  String get billingByModel => 'By model';

  @override
  String get billingContext => 'Context';

  @override
  String get billingComposition => 'Composition';

  @override
  String get billingVsUnorchestrated => 'vs. unorchestrated estimate';

  @override
  String get billingNoComposition => 'No composition details';

  @override
  String get usageNoSavings => 'No savings yet';

  @override
  String usageSavings(Object cost, Object percent) {
    return 'Saved $cost$percent';
  }

  @override
  String get usageFull => '100% full';

  @override
  String usageNearLimit(Object percent) {
    return '$percent% near limit';
  }

  @override
  String usageAlmostFull(Object percent) {
    return '$percent% almost full';
  }

  @override
  String usageUsed(Object percent) {
    return '$percent% used';
  }

  @override
  String get usageAccumulating => 'Cost is accumulating...';

  @override
  String get usagePlanHint => 'Tokens and cost from planning will appear here.';

  @override
  String get usageNoRecords => 'No accumulated token or cost records.';

  @override
  String get usageCostPlaceholder =>
      'Cost — shown after the first model request';

  @override
  String get usageUpdatesPerResponse =>
      'Usage updates after each model response';

  @override
  String get usagePlanUpdates => 'Planning usage updates with model responses';

  @override
  String get usageNoContext => 'No context data';

  @override
  String get usageContextPlaceholder =>
      'Context — shown after the first model request';

  @override
  String get diffNoChanges => 'No uncommitted workspace changes';

  @override
  String get diffTruncated =>
      'The diff is long; some files may not be shown completely';

  @override
  String diffFilesChanged(Object count) {
    return '$count files changed';
  }

  @override
  String get diffNoContent => 'No diff content';

  @override
  String get diffChange => 'Change';

  @override
  String diffLine(int start) {
    return 'Line $start';
  }

  @override
  String diffLineRange(int from, int to) {
    return 'Lines $from-$to';
  }

  @override
  String commitPushFailed(Object error) {
    return 'Commit completed, but push failed: $error';
  }

  @override
  String get commitDestination => 'Commit to';

  @override
  String get commitNewBranch => 'New branch';

  @override
  String get commitCreateBranch => 'Create branch';

  @override
  String get commitBranchName => 'Branch name';

  @override
  String get commonCreate => 'Create';

  @override
  String get commitSelectModel => 'Select generation model';

  @override
  String get commitChanges => 'Commit changes';

  @override
  String commitFilesSummary(int count, int additions, int deletions) {
    return '$count files · +$additions -$deletions';
  }

  @override
  String get commitLoadingModels => 'Loading models...';

  @override
  String get commitNoModel => 'No model configured';

  @override
  String get commitMessageHint =>
      'Commit message (leave blank to generate with AI)';

  @override
  String get commitGenerateMessage => 'Generate commit message with AI';

  @override
  String get commitIncludeUnstaged => 'Include unstaged changes';

  @override
  String get commitCommitting => 'Committing...';

  @override
  String get commitPushing => 'Pushing...';

  @override
  String get commitAndPush => 'Commit and push';

  @override
  String commitPushOnlyAhead(Object count) {
    return 'Push only ($count ahead)';
  }

  @override
  String get composerReasoningOff => 'Off';

  @override
  String get composerReasoningLow => 'Low';

  @override
  String get composerReasoningMedium => 'Medium';

  @override
  String get composerReasoningHigh => 'High';

  @override
  String get composerReasoningExtraHigh => 'Extra high';

  @override
  String get composerReasoningMaximum => 'Maximum';

  @override
  String get composerNoSubagents =>
      'The current orchestration has no subagents';

  @override
  String get composerOrchestrationNotConfigured =>
      'Orchestration not configured';

  @override
  String get composerModel => 'Model';

  @override
  String get composerAuxiliaryModel => 'Auxiliary model';

  @override
  String get composerAuxiliaryModelHint =>
      'Used for title generation and automatic command approval';

  @override
  String get composerAuxiliaryModelManualFallback =>
      'Sending remains available; titles are not generated and reviews use manual mode';

  @override
  String get composerAuxiliaryModelNeedsMainAgent =>
      'Configure the main Agent before selecting an auxiliary model';

  @override
  String get composerVisionModel => 'Vision model';

  @override
  String get composerVisionModelHint =>
      'Used by the vision subagent; falls back to the main model when unset';

  @override
  String get composerVisionModelFollowMain =>
      'Uses the current main model for vision when unset';

  @override
  String get composerVisionModelNeedsMainAgent =>
      'Configure the main Agent before selecting a vision model';

  @override
  String get auxiliaryModelRequiredForAutoReview =>
      'Configure an auxiliary model before enabling automatic reviews';

  @override
  String get auxiliaryModelAutoReviewFallback =>
      'No auxiliary model is configured. Switched to manual review and continued sending';

  @override
  String get composerReasoning => 'Reasoning';

  @override
  String get composerOrchestration => 'Orchestration';

  @override
  String get composerSubagents => 'Subagents';

  @override
  String get composerOrchestrationComponents => 'Orchestration components';

  @override
  String get composerSessionOnly => 'Settings apply only to this session';

  @override
  String get composerRuntimeCore => 'Runtime core';

  @override
  String get composerRuntimeCoreLocked =>
      'The runtime core is locked for this session';

  @override
  String get composerOrchestrationLocked =>
      'Orchestration cannot be edited for this session';

  @override
  String get composerMainAgent => 'Main Agent';

  @override
  String get composerMainAgentPrompt => 'Prompt';

  @override
  String get composerBuiltinMainAgentPrompt => 'Follow built-in agent prompt';

  @override
  String get composerNoSubagentOrchestration => 'No subagents';

  @override
  String composerAgentsCount(int count) {
    return '$count agents';
  }

  @override
  String get composerAlwaysEnabled => 'Always enabled';

  @override
  String get composerMcpDisabledHint =>
      'When disabled, this session will not call tools from this server';

  @override
  String get composerNoSwitchableAgent =>
      'No switchable Agent is available for this session';

  @override
  String get composerNoSwitchableModel =>
      'The current orchestration has no switchable models';

  @override
  String get composerNoReasoningOptions =>
      'The current orchestration has no reasoning options';

  @override
  String get composerNoOrchestrationResources =>
      'No orchestration resources available';

  @override
  String get composerNoMcpServers => 'No MCP servers configured';

  @override
  String get composerNoSkills => 'No Skills available for this project';

  @override
  String get composerSkillsHint => 'Enable available project Skills as needed';

  @override
  String composerProjectSkill(Object layout) {
    return 'Project · $layout';
  }

  @override
  String composerUserSkill(Object layout) {
    return 'User · $layout';
  }

  @override
  String get composerNotEnabled => 'Not enabled';

  @override
  String get composerModelCandidatesHint =>
      'Only models from the selected main-agent provider are shown';

  @override
  String get composerModelLocked =>
      'Models cannot be switched for this session';

  @override
  String get composerFollowOrchestration => 'Follow orchestration';

  @override
  String get composerModelLoadFailed => 'Failed to load candidate models';

  @override
  String get composerReasoningUnsupported =>
      'The current model does not support reasoning';

  @override
  String get composerSessionReasoningOnly => 'Affects only this session';

  @override
  String get composerSelectOrchestration => 'Select orchestration';

  @override
  String get composerSelectOrchestrationSelection => 'Select orchestration';

  @override
  String composerOrchestrationSummary(Object summary) {
    return 'Orchestration $summary';
  }

  @override
  String get composerSubagentOrchestration => 'Subagent orchestration';

  @override
  String get composerSubagentOrchestrationSubtitle =>
      'Control which subagents this session can call';

  @override
  String get composerAgents => 'Agents';

  @override
  String get composerContext => 'Context';

  @override
  String get followUpReorder => 'Drag to reorder messages';

  @override
  String get followUpGuide => 'Guide';

  @override
  String get followUpEdit => 'Edit';

  @override
  String get followUpDeleting => 'Deleting...';

  @override
  String get followUpQueuedGuidance => 'Queued guidance messages';

  @override
  String followUpImages(Object count) {
    return '$count images';
  }

  @override
  String get followUpEmptyGuidance => 'Empty guidance message';

  @override
  String subagentElapsed(Object duration) {
    return 'Elapsed $duration';
  }

  @override
  String get bashApprovalRememberPrefix =>
      'Yes, and don\'t ask again for commands beginning with ';

  @override
  String get bashApprovalDenyAdjust => 'No, tell Eco how to adjust';

  @override
  String projectMoreThreads(Object count) {
    return '$count more';
  }

  @override
  String get projectAwaitingApproval => 'Awaiting approval';

  @override
  String get activityThinkingLabel => 'Thinking';

  @override
  String get activitySubagentFallback => 'Subagent';

  @override
  String get threadNpmScripts => 'npm scripts';

  @override
  String get composerAgent => 'Agent';

  @override
  String get composerMcp => 'MCP';

  @override
  String get composerSkills => 'Skills';

  @override
  String get composerPlanMode => 'Plan Mode';

  @override
  String get composerBashReview => 'Bash Review';

  @override
  String get errorInvalidServerScheme =>
      'Center Server URL must use HTTP or HTTPS.';

  @override
  String get errorDeviceCredentialsRequired =>
      'Device credentials are required.';

  @override
  String get errorQuickPairQrOutdated =>
      'The QR code is missing server or authorization information. Generate a new code from the latest Desktop app.';

  @override
  String get errorServerUnreachable =>
      'Cannot reach the server. Check the address and network.';

  @override
  String get errorWebSocketDisconnected => 'WebSocket is not connected.';

  @override
  String get errorRpcTimeout => 'The Desktop request timed out.';

  @override
  String get errorServerUrlRequired => 'Center Server URL is required.';

  @override
  String get errorConnectionAborted => 'Connection was cancelled.';

  @override
  String get errorWebSocketTimeout => 'WebSocket connection timed out.';

  @override
  String get errorRpcFailed => 'The Desktop request failed.';

  @override
  String get errorDeviceCredentialsMissing => 'Device credentials are missing.';

  @override
  String get errorServerOutdated =>
      'The Server is too old for QR connection. Rebuild and deploy Center Server with docker compose up -d --build.';

  @override
  String errorHttpRequestFailed(Object status) {
    return 'Request failed with HTTP $status.';
  }

  @override
  String get errorNetworkRequestFailed => 'Network request failed.';

  @override
  String get errorInvalidPairQr => 'Invalid pairing QR code.';

  @override
  String get authNetwork =>
      'Cannot connect to the server. Check your network and try again.';

  @override
  String get authDeviceInactive =>
      'This device was removed or disabled on the server. Configure the connection again.';

  @override
  String get authAccountUnusable =>
      'This account is disabled. Contact an administrator.';

  @override
  String get authRelogin => 'Your session expired. Sign in again.';

  @override
  String get authUnknown => 'Connection failed. Try again later.';

  @override
  String signOutCleanupFailed(Object message) {
    return 'Signed out locally, but server cleanup did not complete: $message';
  }

  @override
  String get speechPermissionDenied =>
      'Microphone and speech recognition permissions are required';

  @override
  String get speechUnavailable =>
      'System speech recognition is unavailable on this device';

  @override
  String get speechBusy =>
      'The previous speech recognition request is still running';

  @override
  String get speechNetworkUnavailable =>
      'System speech recognition is temporarily unavailable';

  @override
  String get speechRecognitionFailed => 'Speech recognition failed';

  @override
  String get landingOpenProject => 'Open a project to start coding';

  @override
  String get landingHomePrompt => 'What are you working on?';

  @override
  String landingProjectPrompt(Object name) {
    return 'What should we build in $name?';
  }

  @override
  String get composerLandingPlaceholder => 'Ask anything';

  @override
  String get threadProjectionNoPcSelected =>
      'Select a PC before requesting projection details';

  @override
  String get threadEarlierHistoryLoadFailed =>
      'Failed to load earlier conversation history. Pull down at the top to retry.';
}
