// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appTitle => 'Eco';

  @override
  String get navSessions => '会话';

  @override
  String get navSettings => '设置';

  @override
  String get connectionReconnecting => '正在重连 Center Server…';

  @override
  String get connectionConnected => '连接成功';

  @override
  String get connectionLostReconnecting => '连接断开，正在重连…';

  @override
  String get connectionLiveChannelDisconnected => '实时通道已断开';

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsNotSignedIn => '未登录';

  @override
  String get settingsConnectPcFirst => '请先完成 PC 连接';

  @override
  String get settingsAppearance => '外观';

  @override
  String get settingsTheme => '主题';

  @override
  String get settingsLanguage => '语言';

  @override
  String get settingsLanguageSystem => '跟随系统';

  @override
  String get settingsLanguageChinese => '简体中文';

  @override
  String get settingsLanguageEnglish => 'English';

  @override
  String get settingsThemeSystem => '跟随';

  @override
  String get settingsThemeDark => '深色';

  @override
  String get settingsThemeLight => '浅色';

  @override
  String get settingsDefaultMode => '默认模式';

  @override
  String get settingsDefaultModeCaption => '新建会话时的 Composer 模式';

  @override
  String get settingsAccount => '账户';

  @override
  String get settingsSwitchPc => '切换 PC';

  @override
  String get settingsSwitchPcSubtitle => '选择或绑定其他 Desktop 设备';

  @override
  String get settingsSignOut => '退出登录';

  @override
  String get settingsSignedOut => '已退出登录';

  @override
  String get sessionModeAgentDescription => '代理直接处理任务，并按需要调用已启用的子代理。';

  @override
  String get sessionModePlanDescription => '先生成计划并等待确认，批准后再进入执行。';

  @override
  String get sessionModeAskDescription => '只读回答与代码探索，不修改文件、不执行命令。';

  @override
  String get relativeTimeJustNow => '刚刚';

  @override
  String relativeTimeMinutes(int count) {
    return '$count 分钟';
  }

  @override
  String relativeTimeHours(int count) {
    return '$count 小时';
  }

  @override
  String relativeTimeDays(int count) {
    return '$count 天';
  }

  @override
  String relativeTimeWeeks(int count) {
    return '$count 周';
  }

  @override
  String relativeTimeMonths(int count) {
    return '$count 月';
  }

  @override
  String relativeTimeYears(int count) {
    return '$count 年';
  }

  @override
  String get commonCancel => '取消';

  @override
  String get commonClose => '关闭';

  @override
  String get commonRetry => '重试';

  @override
  String get commonSubmit => '提交';

  @override
  String get commonProcessing => '处理中…';

  @override
  String get commonExpand => '展开';

  @override
  String get commonCollapse => '收起';

  @override
  String get commonBack => '返回';

  @override
  String get commonRefresh => '刷新状态';

  @override
  String get commonDelete => '删除';

  @override
  String get commonEnable => '启用';

  @override
  String get commonEnabled => '已启用';

  @override
  String get commonDisabled => '已停用';

  @override
  String get commonNotConfigured => '未配置';

  @override
  String get commonUnavailable => '未提供';

  @override
  String get commonLoading => '加载中…';

  @override
  String get commonOnline => '在线';

  @override
  String get commonOffline => '离线';

  @override
  String get commonChecking => '检测中';

  @override
  String get commonNotSelected => '未选择';

  @override
  String get toolbarSearch => '搜索会话和项目';

  @override
  String get toolbarOpenProject => '打开项目';

  @override
  String get toolbarSwitchPc => '切换 PC';

  @override
  String get threadsTitle => '会话';

  @override
  String get threadNew => '新建会话';

  @override
  String get threadMore => '更多';

  @override
  String get threadBackToBottom => '回到底部';

  @override
  String get threadWorkspaceCopied => '工作目录已复制';

  @override
  String get threadNoSessions => '暂无会话';

  @override
  String get threadSearchHint => '搜索会话标题或项目';

  @override
  String get threadSearchClear => '清除';

  @override
  String get threadSearchRunning => '正在运行';

  @override
  String get threadSearchSessions => '会话';

  @override
  String get threadSearchProjects => '项目';

  @override
  String get threadSearchNoResults => '没有匹配的会话或项目';

  @override
  String get projectFallbackName => '项目';

  @override
  String get projectNoProjects => '还没有项目';

  @override
  String get projectNoProjectsHint => '点右上角打开项目，输入 Desktop 上的路径即可开始。';

  @override
  String get projectOpen => '打开项目';

  @override
  String get projectOpening => '正在读取 Desktop 文件夹…';

  @override
  String get projectOpenCurrentFolder => '打开当前文件夹';

  @override
  String get projectNoSubfolders => '此文件夹没有子文件夹';

  @override
  String get projectParentFolder => '上一级';

  @override
  String get projectOpened => '项目已打开';

  @override
  String get projectPin => '置顶';

  @override
  String get projectUnpin => '取消置顶';

  @override
  String get projectRemove => '移除项目';

  @override
  String get projectNoPcSelected => '未选择 PC';

  @override
  String get approvalReject => '拒绝';

  @override
  String get approvalApprove => '批准';

  @override
  String get approvalApproveExecution => '批准执行';

  @override
  String get approvalPlanTitle => '计划审批';

  @override
  String get approvalUserRequest => '用户请求';

  @override
  String get approvalAnalysis => '分析';

  @override
  String get approvalPlan => '计划';

  @override
  String get approvalToolReadTitle => '工具读取确认';

  @override
  String get approvalBashTitle => 'Bash 执行确认';

  @override
  String get approvalNeedsClarification => '需要澄清';

  @override
  String get approvalClarificationPrevious => '上一题';

  @override
  String get approvalClarificationNext => '下一题';

  @override
  String get approvalClarificationRecommended => '推荐';

  @override
  String get approvalClarificationCompleteSelection => '完成选择';

  @override
  String get approvalSeverityCritical => '严重';

  @override
  String get approvalSeverityHigh => '高';

  @override
  String get approvalSeverityMedium => '中';

  @override
  String get approvalSeverityLow => '低';

  @override
  String get approvalSkip => '跳过';

  @override
  String get approvalYes => '是';

  @override
  String get approvalImplementPlan => '实施计划';

  @override
  String get approvalLastRunFailed => '上次执行失败';

  @override
  String get approvalIgnore => '忽略';

  @override
  String get approvalExecutePlan => '执行计划 ↵';

  @override
  String get approvalSubmitEnter => '提交 ↵';

  @override
  String get composerAddImage => '添加图片';

  @override
  String get composerVoiceInput => '语音输入';

  @override
  String get composerStopVoiceInput => '停止语音输入';

  @override
  String get composerNoSpeech => '未识别到语音内容';

  @override
  String get composerSendHint => '发送消息…';

  @override
  String get composerFollowUp => '跟进';

  @override
  String get composerRequestChanges => '要求后续变更';

  @override
  String composerPendingImage(int index) {
    return '待发送图片 $index';
  }

  @override
  String composerRemoveImage(int index) {
    return '移除图片 $index';
  }

  @override
  String get voiceListening => '正在聆听';

  @override
  String get voiceTapToStop => '说完后轻触任意处停止';

  @override
  String get voiceStop => '停止';

  @override
  String get setupConnectPc => '连接 PC';

  @override
  String get setupPrevious => '上一步';

  @override
  String get setupNext => '下一步';

  @override
  String get setupEnterApp => '进入应用';

  @override
  String get setupTestConnection => '测试连接';

  @override
  String get setupRetestConnection => '重新测试';

  @override
  String get setupConnectionError => '连接异常';

  @override
  String get setupRetryConnection => '重试连接';

  @override
  String get setupCompleteServerFirst => '请先完成服务器配置';

  @override
  String get setupLogin => '登录';

  @override
  String get setupRegister => '注册';

  @override
  String get setupEmail => '邮箱';

  @override
  String get setupPassword => '密码';

  @override
  String get setupRegisterAndLogin => '注册并登录';

  @override
  String get setupPairingCode => '配对码';

  @override
  String get setupPairingCodeHint => '8 位';

  @override
  String get setupScan => '扫码';

  @override
  String get setupBind => '绑定';

  @override
  String get setupCompleteLoginFirst => '请先完成登录';

  @override
  String get setupBindPcFirst => '请先绑定 PC';

  @override
  String get setupNoBoundDevices => '暂无绑定设备';

  @override
  String get setupScanPcCode => '扫描 PC 端配对码';

  @override
  String get setupScanPcCodeHint => '在 Desktop「互联」页生成二维码';

  @override
  String get setupManualConfiguration => '手动配置';

  @override
  String get setupSelectPc => '选择 PC';

  @override
  String get setupSelectPcHint => '选中一台 Desktop 进入应用，或扫码绑定新设备。';

  @override
  String get setupCurrent => '当前';

  @override
  String get setupBound => '已绑定';

  @override
  String get setupSelectOnlinePcFirst => '请选择一台在线 PC 后再进入应用';

  @override
  String get setupBindNewPc => '绑定新 PC';

  @override
  String get pairingScanTitle => '扫描配对码';

  @override
  String get pairingScanHint => '将 Desktop「互联」页的二维码放入框内';

  @override
  String get pairingTorchOn => '打开灯光';

  @override
  String get pairingTorchOff => '关闭灯光';

  @override
  String get setupWizardServerTitle => '配置服务器';

  @override
  String get setupWizardLoginTitle => '注册 / 登录';

  @override
  String get setupWizardBindTitle => '绑定 PC';

  @override
  String get setupWizardSelectTitle => '选择 PC';

  @override
  String get setupWizardServerSubtitle => '填写 Center Server 地址并确认可达';

  @override
  String get setupWizardLoginSubtitle => '登录账号并注册本机为移动设备';

  @override
  String get setupWizardBindSubtitle => '在 Desktop 生成配对码后扫码或手输';

  @override
  String get setupWizardSelectSubtitle => '选择要远程操控的 PC';

  @override
  String get setupWizardServerShort => '服务器';

  @override
  String get setupWizardAccountShort => '账号';

  @override
  String get setupWizardPairShort => '绑定';

  @override
  String get setupStatusServerReachable => '服务器可达';

  @override
  String get setupStatusServerHelp => '请检查地址、Wi‑Fi 与 Server 是否监听 0.0.0.0';

  @override
  String get setupStatusAccountDevice => '账号与手机设备';

  @override
  String get setupStatusRegisteringDevice => '正在注册本机设备…';

  @override
  String get setupStatusLiveChannel => '实时通道 (WebSocket)';

  @override
  String get setupStatusCenterConnected => '已连接 Center Server';

  @override
  String get setupStatusConnecting => '正在连接…';

  @override
  String get setupStatusPairPc => '绑定 PC';

  @override
  String setupStatusBoundCount(int count) {
    return '已绑定 $count 台';
  }

  @override
  String get setupStatusPairHint => '在 Desktop 生成配对码后扫码或手输';

  @override
  String get setupStatusSelectControlledPc => '选择操控的 PC';

  @override
  String setupStatusCheckingDevice(Object name) {
    return '$name · 检测中…';
  }

  @override
  String setupStatusDeviceOnline(Object name) {
    return '$name · 在线';
  }

  @override
  String setupStatusDeviceOffline(Object name) {
    return '$name · 离线';
  }

  @override
  String get setupStatusDesktopOfflineHelp =>
      'Desktop 当前离线，请确认 Desktop 已连接同一 Server';

  @override
  String get setupStatusWebSocketDisconnected => 'WebSocket 未连接，请重新登录或下拉刷新';

  @override
  String get setupProgressTitle => '连接进度';

  @override
  String get setupConnectedReady => '已连接，选择 PC 后可进入主界面';

  @override
  String setupOpenedDevice(Object name) {
    return '已打开 $name';
  }

  @override
  String setupBoundDevice(Object name) {
    return '已绑定 $name';
  }

  @override
  String setupSelectedDevice(Object name) {
    return '已选择 $name';
  }

  @override
  String setupSelectedDeviceOffline(Object name) {
    return '$name 已选择，但当前离线';
  }

  @override
  String setupDeviceOfflineServerHelp(Object name) {
    return '$name 当前离线，请确认 Desktop 已连接 Server';
  }

  @override
  String setupBoundDeviceOffline(Object name) {
    return '$name 已绑定，但当前离线';
  }

  @override
  String get setupLegacyQr => '旧版二维码，请完成登录后绑定';

  @override
  String get setupServerReachable => '服务器可达';

  @override
  String get setupServerUnreachable => '无法访问服务器，请检查地址与网络';

  @override
  String get setupServerRequired => '请先完成服务器配置';

  @override
  String get setupLoginSuccess => '登录成功，WebSocket 已连接';

  @override
  String get setupReconnectAttempted => '已尝试重新连接 WebSocket';

  @override
  String get setupBoundPcFallback => '已绑定 PC';

  @override
  String get composerWorkMode => '工作模式';

  @override
  String get composerWorkModeSubtitle => '选择当前会话的运行方式';

  @override
  String get composerMode => '模式';

  @override
  String get composerBashApproval => 'Bash 审批';

  @override
  String get composerBashApprovalSubtitle => '控制命令执行前的确认方式';

  @override
  String get bashReviewAlways => '每次确认';

  @override
  String get bashReviewAlwaysDescription => '执行命令或访问工作区外路径前都询问';

  @override
  String get bashReviewAuto => '风险时确认';

  @override
  String get bashReviewAutoDescription => '低风险自动执行；高风险命令或外路径访问仍询问';

  @override
  String get bashReviewAllowAll => '自动执行';

  @override
  String get bashReviewAllowAllDescription => '跳过确认（仍受当前模式、编排与安全策略限制）';

  @override
  String get composerSettings => 'Composer 设置';

  @override
  String get composerUnsupportedImage => '仅支持 JPEG、PNG、GIF 和 WebP 图片';

  @override
  String get composerOrchestrationSelection => '编排组合';

  @override
  String activityToolIncomplete(Object text) {
    return '工具未完成 · $text';
  }

  @override
  String activityReadFiles(Object count) {
    return '已读取 $count 个文件';
  }

  @override
  String activityWroteFiles(Object count) {
    return '已写入 $count 个文件';
  }

  @override
  String activityEditedFiles(Object count) {
    return '已编辑 $count 个文件';
  }

  @override
  String get activitySearchedCode => '已搜索代码';

  @override
  String activitySearchedCodeTimes(Object count) {
    return '已搜索代码 $count 次';
  }

  @override
  String activityRanCommands(Object count) {
    return '已运行 $count 条命令';
  }

  @override
  String activityCalledSubagents(Object count) {
    return '已调用 $count 个子代理';
  }

  @override
  String activityRanTools(Object count) {
    return '已执行 $count 个工具';
  }

  @override
  String get activityCreatingTask => '正在创建任务';

  @override
  String get activityCreatedTask => '已创建任务';

  @override
  String get activityUpdatingTask => '正在更新任务';

  @override
  String get activityUpdatedTask => '已更新任务';

  @override
  String get activityWriting => '正在写入';

  @override
  String get activityWrote => '已写入';

  @override
  String get activityEditing => '正在编辑';

  @override
  String get activityEdited => '已编辑';

  @override
  String get activityEditedFile => '编辑了文件';

  @override
  String get activityReading => '正在读取';

  @override
  String get activityRead => '已读取';

  @override
  String get activitySearching => '正在搜索';

  @override
  String get activitySearched => '已搜索';

  @override
  String get activityRunning => '正在运行';

  @override
  String get activityRan => '已运行';

  @override
  String get activityRanCommand => '运行了命令';

  @override
  String activityViewImages(Object count) {
    return '查看 $count 张图片';
  }

  @override
  String get activityCallingSubagent => '正在调用子代理';

  @override
  String get activityCalledSubagent => '已调用子代理';

  @override
  String get activityExecuting => '正在执行';

  @override
  String get activityExecuted => '已执行';

  @override
  String activityListPair(Object first, Object second) {
    return '$first和$second';
  }

  @override
  String activityListEnd(Object head, Object last) {
    return '$head和$last';
  }

  @override
  String get activityProcessing => '处理中';

  @override
  String get activityProcessed => '已处理';

  @override
  String get activityExecutionProcess => '执行过程';

  @override
  String get activityExecutionResult => '本轮执行结果';

  @override
  String get activityFinalOutput => '最终输出';

  @override
  String get activityExpandFull => '展开全文';

  @override
  String get activityClarificationAnswer => '询问回答';

  @override
  String get activityNoneSelected => '（未选择）';

  @override
  String get activityThinking => '正在思考';

  @override
  String activityRunFailed(Object suffix) {
    return '运行失败$suffix';
  }

  @override
  String activityRunningSuffix(Object suffix) {
    return '正在运行$suffix';
  }

  @override
  String activityRanSuffix(Object suffix) {
    return '已运行$suffix';
  }

  @override
  String get activityFailed => '失败';

  @override
  String activitySubagentTask(Object title) {
    return '$title 子代理任务';
  }

  @override
  String get activityTaskGoal => '任务目标';

  @override
  String get activityWaitingMission => '等待任务说明…';

  @override
  String get activityWaitingEvents => '等待执行事件…';

  @override
  String get activityWorking => '工作中';

  @override
  String get activityCompressingContext => '正在自动压缩上下文';

  @override
  String get activityContextCompressed => '上下文已自动压缩';

  @override
  String get activityContextCompressionFailed => '上下文压缩失败';

  @override
  String get activityContextCompressionPaused => '自动上下文压缩已暂停';

  @override
  String get activityPromptCacheDrop => 'Prompt cache 命中率大幅下降';

  @override
  String get activityPreparingRetry => '准备重试';

  @override
  String get activityRunDiagnostics => '运行诊断';

  @override
  String activityAllowOutsideWorkspace(Object tool) {
    return '允许在工作区外执行 $tool？';
  }

  @override
  String get activityToolPermissionRequired => '需要确认工具权限';

  @override
  String get activityReadSkill => '读取技能';

  @override
  String get activityStartSubagent => '启动子代理';

  @override
  String get activityConnectionFailed => '连接失败';

  @override
  String activityConnectionFailedHttp(Object status) {
    return '连接失败 · HTTP $status';
  }

  @override
  String activityReconnectAttempt(Object attempt, Object max) {
    return '重连 $attempt/$max';
  }

  @override
  String get roleVision => '看图';

  @override
  String get roleExplore => '探索';

  @override
  String get roleArchitect => '架构';

  @override
  String get roleCoder => '编码';

  @override
  String get roleReviewer => '审查';

  @override
  String get roleTester => '测试';

  @override
  String get toolRead => '读取';

  @override
  String get toolWrite => '写入';

  @override
  String get toolEdit => '编辑';

  @override
  String get toolSearch => '搜索';

  @override
  String get toolFind => '查找';

  @override
  String get toolRunCommand => '运行命令';

  @override
  String get toolCall => '调用';

  @override
  String get toolUpdateTasks => '更新任务';

  @override
  String get toolCreateTask => '创建任务';

  @override
  String get toolListTasks => '列出任务';

  @override
  String get toolReadTaskOutput => '读取任务输出';

  @override
  String get toolClarify => '澄清问题';

  @override
  String get toolWebSearch => '网络搜索';

  @override
  String get toolWebFetch => '获取网页';

  @override
  String get threadTasks => '任务进度';

  @override
  String get threadPlan => '计划';

  @override
  String get threadPlanEmpty => '暂无可查看的计划';

  @override
  String get threadCodeReview => '代码审查';

  @override
  String get threadCommitPush => '提交与推送';

  @override
  String get threadStartFirstForTasks => '请先开始会话后再查看任务进度';

  @override
  String get threadSelectOrchestrationFirst => '请先在 Composer 设置中选择编排组合';

  @override
  String get threadLoadingCommit => '正在加载提交信息…';

  @override
  String get threadCommittedPushed => '已提交并推送到远程';

  @override
  String get threadPushed => '已推送到远程';

  @override
  String get threadCommitted => '已提交';

  @override
  String threadPullBehind(Object count) {
    return '拉取（落后 $count）';
  }

  @override
  String get threadFetch => '抓取';

  @override
  String get threadPulling => '正在拉取…';

  @override
  String get threadPullConflictDesktop => '拉取产生冲突，请在 Desktop 处理';

  @override
  String threadPullConflictFiles(Object files) {
    return '拉取冲突：$files';
  }

  @override
  String get threadPullSuccess => '拉取成功';

  @override
  String get threadAlreadySynced => '当前分支已与远程同步';

  @override
  String get threadFetching => '正在抓取…';

  @override
  String get threadFetchComplete => '抓取完成';

  @override
  String get threadTaskListEmpty => '暂无任务列表';

  @override
  String get threadTaskInProgress => '进行中';

  @override
  String get threadTaskCompleted => '已完成';

  @override
  String get threadTaskBlocked => '受阻';

  @override
  String get threadTaskStopped => '已停止';

  @override
  String get threadTaskPending => '待执行';

  @override
  String get threadDesktopDisconnected => '未连接 Desktop';

  @override
  String get threadNpmScriptsEmpty => '未找到 package.json scripts';

  @override
  String get threadNpmScriptsSearchHint => '搜索脚本';

  @override
  String get threadNpmScriptsNoMatches => '没有匹配的脚本';

  @override
  String get threadExtraArgs => '附加参数';

  @override
  String threadExtraArgsValue(Object args) {
    return '附加参数：$args';
  }

  @override
  String get threadRun => '运行';

  @override
  String get threadRunStarting => '启动中';

  @override
  String get threadRunRunning => '运行中';

  @override
  String get threadRunCompleted => '已完成';

  @override
  String get threadRunFailed => '执行失败';

  @override
  String get threadRunStopped => '已停止';

  @override
  String get threadStopping => '停止中';

  @override
  String get threadStop => '停止';

  @override
  String get threadWaitingCommandOutput => '等待 Desktop 返回命令输出…';

  @override
  String get threadOutputTruncated => '输出过长，已仅保留最近内容';

  @override
  String get threadDelete => '删除会话';

  @override
  String threadDeleteConfirm(Object title) {
    return '确定删除「$title」？此操作不可撤销。';
  }

  @override
  String get threadDeleted => '会话已删除';

  @override
  String get threadEditGuidanceHint => '编辑引导消息…';

  @override
  String get threadProjectionLoading => '运行投影加载中…';

  @override
  String get threadProjectionUnavailable => '运行投影尚未就绪';

  @override
  String get threadNoSubagentDetails => '暂无子代理详情';

  @override
  String get threadNoToolDetails => '暂无工具详情';

  @override
  String get threadRequestingDetails => '正在请求详情…';

  @override
  String get threadDetailsFailed => '详情请求失败';

  @override
  String get threadNoDetailsResponse => '未收到详情响应';

  @override
  String get threadZeroDetails => '桌面端返回了 0 条详情';

  @override
  String get threadDetailsUnparseable => '移动端已发起请求，但没有拿到可解析的 detail 结果。';

  @override
  String threadDetailsComplete(Object key, Object kind) {
    return '请求已完成，kind=$kind, key=$key。';
  }

  @override
  String get threadEditingGuidance => '正在编辑引导消息';

  @override
  String get billingTitle => '计费';

  @override
  String get billingSessionTotal => '本会话累计 · Eco 编排后费用';

  @override
  String get billingComparison => '费用对比';

  @override
  String get billingUnorchestrated => '未编排';

  @override
  String billingPlannerEstimate(Object model) {
    return '按 $model 单价估算';
  }

  @override
  String get billingMainModelEstimate => '按主模型单价估算';

  @override
  String get billingEco => '经济编程';

  @override
  String get billingEcoSubtitle => 'Eco 编排后的实际费用';

  @override
  String get billingSavings => '节省';

  @override
  String get billingTokenUsage => 'Token 用量';

  @override
  String get billingInput => '输入';

  @override
  String get billingOutput => '输出';

  @override
  String get billingCacheHitRate => '缓存命中率';

  @override
  String get billingCacheRead => '缓存读取';

  @override
  String get billingCacheWrite => '缓存写入';

  @override
  String get billingByModel => '按模型';

  @override
  String get billingContext => '上下文';

  @override
  String get billingComposition => '构成';

  @override
  String get billingVsUnorchestrated => '相对未编排估算';

  @override
  String get billingNoComposition => '暂无构成明细';

  @override
  String get usageNoSavings => '暂无节省';

  @override
  String usageSavings(Object cost, Object percent) {
    return '节省 $cost$percent';
  }

  @override
  String get usageFull => '100% 已满';

  @override
  String usageNearLimit(Object percent) {
    return '$percent% 接近上限';
  }

  @override
  String usageAlmostFull(Object percent) {
    return '$percent% 即将触顶';
  }

  @override
  String usageUsed(Object percent) {
    return '$percent% 已用';
  }

  @override
  String get usageAccumulating => '费用累计中…';

  @override
  String get usagePlanHint => '计划阶段已产生的 token 与费用将显示在此处。';

  @override
  String get usageNoRecords => '暂无累计 token 或费用记录。';

  @override
  String get usageCostPlaceholder => '费用 — 有模型请求后显示';

  @override
  String get usageUpdatesPerResponse => '用量随每轮模型响应更新';

  @override
  String get usagePlanUpdates => '计划阶段用量将随模型响应更新';

  @override
  String get usageNoContext => '暂无上下文数据';

  @override
  String get usageContextPlaceholder => '上下文 — 有模型请求后显示';

  @override
  String get diffNoChanges => '工作区暂无未提交变更';

  @override
  String get diffTruncated => 'Diff 内容过长，部分文件可能未完整显示';

  @override
  String diffFilesChanged(Object count) {
    return '$count 个文件已更改';
  }

  @override
  String get diffNoContent => '暂无 diff 内容';

  @override
  String get diffChange => '变更';

  @override
  String diffLine(int start) {
    return '第 $start 行';
  }

  @override
  String diffLineRange(int from, int to) {
    return '第 $from-$to 行';
  }

  @override
  String commitPushFailed(Object error) {
    return '提交已完成，但推送失败：$error';
  }

  @override
  String get commitDestination => '提交到';

  @override
  String get commitNewBranch => '新分支';

  @override
  String get commitCreateBranch => '新建分支';

  @override
  String get commitBranchName => '分支名称';

  @override
  String get commonCreate => '创建';

  @override
  String get commitSelectModel => '选择生成模型';

  @override
  String get commitChanges => '提交变更';

  @override
  String commitFilesSummary(int count, int additions, int deletions) {
    return '$count 个文件 · +$additions -$deletions';
  }

  @override
  String get commitLoadingModels => '加载模型…';

  @override
  String get commitNoModel => '未配置模型';

  @override
  String get commitMessageHint => '提交信息（留空则 AI 生成）';

  @override
  String get commitGenerateMessage => 'AI 生成提交信息';

  @override
  String get commitIncludeUnstaged => '包含未暂存的更改';

  @override
  String get commitCommitting => '提交中…';

  @override
  String get commitPushing => '推送中…';

  @override
  String get commitAndPush => '提交并推送';

  @override
  String commitPushOnlyAhead(Object count) {
    return '仅推送（领先 $count）';
  }

  @override
  String get composerReasoningOff => '关闭';

  @override
  String get composerReasoningLow => '低';

  @override
  String get composerReasoningMedium => '中';

  @override
  String get composerReasoningHigh => '高';

  @override
  String get composerReasoningExtraHigh => '极高';

  @override
  String get composerReasoningMaximum => '最大';

  @override
  String get composerNoSubagents => '当前方案未配置子代理';

  @override
  String get composerOrchestrationNotConfigured => '编排未配置';

  @override
  String get composerModel => '模型';

  @override
  String get composerAuxiliaryModel => '辅助模型';

  @override
  String get composerAuxiliaryModelHint => '用于标题生成、命令自动审批';

  @override
  String get composerAuxiliaryModelManualFallback => '仍可发送；标题不会自动生成，审查将使用手动模式';

  @override
  String get composerAuxiliaryModelNeedsMainAgent => '请先配置主 Agent，再选择辅助模型';

  @override
  String get composerVisionModel => '视觉模型';

  @override
  String get composerVisionModelHint => '用于看图子代理；未配置时使用主模型';

  @override
  String get composerVisionModelFollowMain => '未配置时使用当前主模型看图';

  @override
  String get composerVisionModelNeedsMainAgent => '请先配置主 Agent，再选择视觉模型';

  @override
  String get auxiliaryModelRequiredForAutoReview => '尚未配置辅助模型，无法启用自动审查';

  @override
  String get auxiliaryModelAutoReviewFallback => '尚未配置辅助模型，已切换为手动审查并继续发送';

  @override
  String get composerReasoning => '推理';

  @override
  String get composerOrchestration => '编排';

  @override
  String get composerSubagents => '子代理';

  @override
  String get composerOrchestrationComponents => '编排组件';

  @override
  String get composerSessionOnly => '配置仅作用于当前会话';

  @override
  String get composerRuntimeCore => '运行核心';

  @override
  String get composerRuntimeCoreLocked => '当前会话的运行核心已锁定';

  @override
  String get composerOrchestrationLocked => '当前会话不可编辑编排';

  @override
  String get composerMainAgent => '主 Agent';

  @override
  String get composerMainAgentPrompt => '提示词';

  @override
  String get composerBuiltinMainAgentPrompt => '跟随 Agent 内置提示词';

  @override
  String get composerNoSubagentOrchestration => '不使用子代理';

  @override
  String composerAgentsCount(int count) {
    return '$count 个代理';
  }

  @override
  String get composerAlwaysEnabled => '始终启用';

  @override
  String get composerMcpDisabledHint => '关闭后当前会话不再调用该服务器工具';

  @override
  String get composerNoSwitchableAgent => '当前会话未提供可切换的 Agent';

  @override
  String get composerNoSwitchableModel => '当前方案未配置可切换模型';

  @override
  String get composerNoReasoningOptions => '当前方案未配置推理强度';

  @override
  String get composerNoOrchestrationResources => '暂无可用编排资源';

  @override
  String get composerNoMcpServers => '未配置 MCP 服务器';

  @override
  String get composerNoSkills => '当前项目没有可用 Skills';

  @override
  String get composerSkillsHint => '按需启用当前项目可用的 Skills';

  @override
  String composerProjectSkill(Object layout) {
    return '项目 · $layout';
  }

  @override
  String composerUserSkill(Object layout) {
    return '用户 · $layout';
  }

  @override
  String get composerNotEnabled => '未启用';

  @override
  String get composerModelCandidatesHint => '仅显示当前方案 Provider 的候选模型';

  @override
  String get composerModelLocked => '当前会话不可切换模型';

  @override
  String get composerFollowOrchestration => '跟随编排';

  @override
  String get composerModelLoadFailed => '候选模型加载失败';

  @override
  String get composerReasoningUnsupported => '当前模型不支持推理';

  @override
  String get composerSessionReasoningOnly => '仅影响当前会话';

  @override
  String get composerSelectOrchestration => '选择编排';

  @override
  String get composerSelectOrchestrationSelection => '选择编排组合';

  @override
  String composerOrchestrationSummary(Object summary) {
    return '编排 $summary';
  }

  @override
  String get composerSubagentOrchestration => '子代理编排';

  @override
  String get composerSubagentOrchestrationSubtitle => '控制当前会话可调用的子代理';

  @override
  String get composerAgents => '代理';

  @override
  String get composerContext => '上下文';

  @override
  String get followUpReorder => '拖动调整消息顺序';

  @override
  String get followUpGuide => '引导';

  @override
  String get followUpEdit => '修改';

  @override
  String get followUpDeleting => '删除中…';

  @override
  String get followUpQueuedGuidance => '已排队的引导消息';

  @override
  String followUpImages(Object count) {
    return '$count 张图片';
  }

  @override
  String get followUpEmptyGuidance => '空引导消息';

  @override
  String subagentElapsed(Object duration) {
    return '用时 $duration';
  }

  @override
  String get bashApprovalRememberPrefix => '是，且对于以后续内容开头的命令不再询问 ';

  @override
  String get bashApprovalDenyAdjust => '否，请告知 Eco 如何调整';

  @override
  String projectMoreThreads(Object count) {
    return '还有 $count 条';
  }

  @override
  String get projectAwaitingApproval => '待批准';

  @override
  String get activityThinkingLabel => '思考';

  @override
  String get activitySubagentFallback => '子代理';

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
  String get errorInvalidServerScheme => 'Center Server 地址必须使用 HTTP 或 HTTPS。';

  @override
  String get errorDeviceCredentialsRequired => '缺少设备凭据。';

  @override
  String get errorQuickPairQrOutdated =>
      '二维码缺少服务器地址或授权信息，请使用最新版 Desktop 生成新的二维码。';

  @override
  String get errorServerUnreachable => '无法访问服务器，请检查地址与网络。';

  @override
  String get errorWebSocketDisconnected => 'WebSocket 尚未连接。';

  @override
  String get errorRpcTimeout => 'Desktop 请求超时。';

  @override
  String get errorServerUrlRequired => '请先配置 Center Server 地址。';

  @override
  String get errorConnectionAborted => '连接已取消。';

  @override
  String get errorWebSocketTimeout => 'WebSocket 连接超时。';

  @override
  String get errorRpcFailed => 'Desktop 请求失败。';

  @override
  String get errorDeviceCredentialsMissing => '缺少设备凭据。';

  @override
  String get errorServerOutdated =>
      'Server 版本过旧，缺少扫码连接接口。请使用 docker compose up -d --build 重新构建并部署 Center Server。';

  @override
  String errorHttpRequestFailed(Object status) {
    return '请求失败，HTTP $status。';
  }

  @override
  String get errorNetworkRequestFailed => '网络请求失败。';

  @override
  String get errorInvalidPairQr => '无效的配对二维码。';

  @override
  String get authNetwork => '无法连接服务端，请检查网络后重试。';

  @override
  String get authDeviceInactive => '设备已在服务端注销或禁用，请重新配置连接。';

  @override
  String get authAccountUnusable => '账号已停用，请联系管理员。';

  @override
  String get authRelogin => '登录已失效，请重新登录。';

  @override
  String get authUnknown => '连接失败，请稍后重试。';

  @override
  String signOutCleanupFailed(Object message) {
    return '本地已退出，但服务端注销未完成：$message';
  }

  @override
  String get speechPermissionDenied => '需要麦克风与语音识别权限';

  @override
  String get speechUnavailable => '当前设备没有可用的系统语音识别';

  @override
  String get speechBusy => '正在识别上一段语音';

  @override
  String get speechNetworkUnavailable => '系统语音识别服务暂时不可用';

  @override
  String get speechRecognitionFailed => '语音识别失败';

  @override
  String get landingOpenProject => '打开一个项目开始编码';

  @override
  String get landingHomePrompt => '你在忙什么？';

  @override
  String landingProjectPrompt(Object name) {
    return '我们应该在 $name 中构建什么？';
  }

  @override
  String get composerLandingPlaceholder => '尽管问';

  @override
  String get threadProjectionNoPcSelected => '未选择 PC，无法请求投影详情';

  @override
  String get threadEarlierHistoryLoadFailed => '加载更早的会话记录失败，请在顶部再次下拉重试';
}
