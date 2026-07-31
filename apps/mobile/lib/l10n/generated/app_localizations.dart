import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'generated/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// No description provided for @appTitle.
  ///
  /// In en, this message translates to:
  /// **'Eco'**
  String get appTitle;

  /// No description provided for @navSessions.
  ///
  /// In en, this message translates to:
  /// **'Sessions'**
  String get navSessions;

  /// No description provided for @navSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// No description provided for @connectionReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Reconnecting to Center Server...'**
  String get connectionReconnecting;

  /// No description provided for @connectionConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get connectionConnected;

  /// No description provided for @connectionLostReconnecting.
  ///
  /// In en, this message translates to:
  /// **'Connection lost. Reconnecting...'**
  String get connectionLostReconnecting;

  /// No description provided for @connectionLiveChannelDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Live connection disconnected'**
  String get connectionLiveChannelDisconnected;

  /// No description provided for @settingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settingsTitle;

  /// No description provided for @settingsNotSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Not signed in'**
  String get settingsNotSignedIn;

  /// No description provided for @settingsConnectPcFirst.
  ///
  /// In en, this message translates to:
  /// **'Connect a PC first'**
  String get settingsConnectPcFirst;

  /// No description provided for @settingsAppearance.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get settingsAppearance;

  /// No description provided for @settingsTheme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get settingsTheme;

  /// No description provided for @settingsLanguage.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get settingsLanguage;

  /// No description provided for @settingsLanguageSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsLanguageSystem;

  /// No description provided for @settingsLanguageChinese.
  ///
  /// In en, this message translates to:
  /// **'Chinese'**
  String get settingsLanguageChinese;

  /// No description provided for @settingsLanguageEnglish.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get settingsLanguageEnglish;

  /// No description provided for @settingsThemeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get settingsThemeSystem;

  /// No description provided for @settingsThemeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get settingsThemeDark;

  /// No description provided for @settingsThemeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get settingsThemeLight;

  /// No description provided for @settingsDefaultMode.
  ///
  /// In en, this message translates to:
  /// **'Default mode'**
  String get settingsDefaultMode;

  /// No description provided for @settingsDefaultModeCaption.
  ///
  /// In en, this message translates to:
  /// **'Composer mode for new sessions'**
  String get settingsDefaultModeCaption;

  /// No description provided for @settingsAccount.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get settingsAccount;

  /// No description provided for @settingsSwitchPc.
  ///
  /// In en, this message translates to:
  /// **'Switch PC'**
  String get settingsSwitchPc;

  /// No description provided for @settingsSwitchPcSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Select or pair another Desktop device'**
  String get settingsSwitchPcSubtitle;

  /// No description provided for @settingsSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get settingsSignOut;

  /// No description provided for @settingsSignedOut.
  ///
  /// In en, this message translates to:
  /// **'Signed out'**
  String get settingsSignedOut;

  /// No description provided for @sessionModeAgentDescription.
  ///
  /// In en, this message translates to:
  /// **'Handle tasks directly and call enabled subagents when needed.'**
  String get sessionModeAgentDescription;

  /// No description provided for @sessionModePlanDescription.
  ///
  /// In en, this message translates to:
  /// **'Create a plan and wait for approval before executing it.'**
  String get sessionModePlanDescription;

  /// No description provided for @sessionModeAskDescription.
  ///
  /// In en, this message translates to:
  /// **'Answer and explore code without changing files or running commands.'**
  String get sessionModeAskDescription;

  /// No description provided for @relativeTimeJustNow.
  ///
  /// In en, this message translates to:
  /// **'Just now'**
  String get relativeTimeJustNow;

  /// No description provided for @relativeTimeMinutes.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 minute} other{{count} minutes}}'**
  String relativeTimeMinutes(int count);

  /// No description provided for @relativeTimeHours.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 hour} other{{count} hours}}'**
  String relativeTimeHours(int count);

  /// No description provided for @relativeTimeDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}}'**
  String relativeTimeDays(int count);

  /// No description provided for @relativeTimeWeeks.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 week} other{{count} weeks}}'**
  String relativeTimeWeeks(int count);

  /// No description provided for @relativeTimeMonths.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 month} other{{count} months}}'**
  String relativeTimeMonths(int count);

  /// No description provided for @relativeTimeYears.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 year} other{{count} years}}'**
  String relativeTimeYears(int count);

  /// No description provided for @commonCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get commonCancel;

  /// No description provided for @commonClose.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get commonClose;

  /// No description provided for @commonRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get commonRetry;

  /// No description provided for @commonSubmit.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get commonSubmit;

  /// No description provided for @commonProcessing.
  ///
  /// In en, this message translates to:
  /// **'Processing...'**
  String get commonProcessing;

  /// No description provided for @commonExpand.
  ///
  /// In en, this message translates to:
  /// **'Expand'**
  String get commonExpand;

  /// No description provided for @commonCollapse.
  ///
  /// In en, this message translates to:
  /// **'Collapse'**
  String get commonCollapse;

  /// No description provided for @commonBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get commonBack;

  /// No description provided for @commonRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh status'**
  String get commonRefresh;

  /// No description provided for @commonDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get commonDelete;

  /// No description provided for @commonEnable.
  ///
  /// In en, this message translates to:
  /// **'Enable'**
  String get commonEnable;

  /// No description provided for @commonEnabled.
  ///
  /// In en, this message translates to:
  /// **'Enabled'**
  String get commonEnabled;

  /// No description provided for @commonDisabled.
  ///
  /// In en, this message translates to:
  /// **'Disabled'**
  String get commonDisabled;

  /// No description provided for @commonNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Not configured'**
  String get commonNotConfigured;

  /// No description provided for @commonUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get commonUnavailable;

  /// No description provided for @commonLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get commonLoading;

  /// No description provided for @commonOnline.
  ///
  /// In en, this message translates to:
  /// **'Online'**
  String get commonOnline;

  /// No description provided for @commonOffline.
  ///
  /// In en, this message translates to:
  /// **'Offline'**
  String get commonOffline;

  /// No description provided for @commonChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking'**
  String get commonChecking;

  /// No description provided for @commonNotSelected.
  ///
  /// In en, this message translates to:
  /// **'Not selected'**
  String get commonNotSelected;

  /// No description provided for @toolbarSearch.
  ///
  /// In en, this message translates to:
  /// **'Search sessions and projects'**
  String get toolbarSearch;

  /// No description provided for @toolbarOpenProject.
  ///
  /// In en, this message translates to:
  /// **'Open project'**
  String get toolbarOpenProject;

  /// No description provided for @toolbarSwitchPc.
  ///
  /// In en, this message translates to:
  /// **'Switch PC'**
  String get toolbarSwitchPc;

  /// No description provided for @threadsTitle.
  ///
  /// In en, this message translates to:
  /// **'Sessions'**
  String get threadsTitle;

  /// No description provided for @threadNew.
  ///
  /// In en, this message translates to:
  /// **'New session'**
  String get threadNew;

  /// No description provided for @threadMore.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get threadMore;

  /// No description provided for @threadBackToBottom.
  ///
  /// In en, this message translates to:
  /// **'Back to bottom'**
  String get threadBackToBottom;

  /// No description provided for @threadWorkspaceCopied.
  ///
  /// In en, this message translates to:
  /// **'Working directory copied'**
  String get threadWorkspaceCopied;

  /// No description provided for @threadNoSessions.
  ///
  /// In en, this message translates to:
  /// **'No sessions'**
  String get threadNoSessions;

  /// No description provided for @threadSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search session titles or projects'**
  String get threadSearchHint;

  /// No description provided for @threadSearchClear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get threadSearchClear;

  /// No description provided for @threadSearchRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get threadSearchRunning;

  /// No description provided for @threadSearchSessions.
  ///
  /// In en, this message translates to:
  /// **'Sessions'**
  String get threadSearchSessions;

  /// No description provided for @threadSearchProjects.
  ///
  /// In en, this message translates to:
  /// **'Projects'**
  String get threadSearchProjects;

  /// No description provided for @threadSearchNoResults.
  ///
  /// In en, this message translates to:
  /// **'No matching sessions or projects'**
  String get threadSearchNoResults;

  /// No description provided for @projectFallbackName.
  ///
  /// In en, this message translates to:
  /// **'Project'**
  String get projectFallbackName;

  /// No description provided for @projectNoProjects.
  ///
  /// In en, this message translates to:
  /// **'No projects yet'**
  String get projectNoProjects;

  /// No description provided for @projectNoProjectsHint.
  ///
  /// In en, this message translates to:
  /// **'Open a project from the top right and enter a path on Desktop to begin.'**
  String get projectNoProjectsHint;

  /// No description provided for @projectOpen.
  ///
  /// In en, this message translates to:
  /// **'Open project'**
  String get projectOpen;

  /// No description provided for @projectOpening.
  ///
  /// In en, this message translates to:
  /// **'Reading Desktop folders...'**
  String get projectOpening;

  /// No description provided for @projectOpenCurrentFolder.
  ///
  /// In en, this message translates to:
  /// **'Open current folder'**
  String get projectOpenCurrentFolder;

  /// No description provided for @projectNoSubfolders.
  ///
  /// In en, this message translates to:
  /// **'This folder has no subfolders'**
  String get projectNoSubfolders;

  /// No description provided for @projectParentFolder.
  ///
  /// In en, this message translates to:
  /// **'Parent folder'**
  String get projectParentFolder;

  /// No description provided for @projectOpened.
  ///
  /// In en, this message translates to:
  /// **'Project opened'**
  String get projectOpened;

  /// No description provided for @projectPin.
  ///
  /// In en, this message translates to:
  /// **'Pin'**
  String get projectPin;

  /// No description provided for @projectUnpin.
  ///
  /// In en, this message translates to:
  /// **'Unpin'**
  String get projectUnpin;

  /// No description provided for @projectRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove project'**
  String get projectRemove;

  /// No description provided for @projectNoPcSelected.
  ///
  /// In en, this message translates to:
  /// **'No PC selected'**
  String get projectNoPcSelected;

  /// No description provided for @approvalReject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get approvalReject;

  /// No description provided for @approvalApprove.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get approvalApprove;

  /// No description provided for @approvalApproveExecution.
  ///
  /// In en, this message translates to:
  /// **'Approve execution'**
  String get approvalApproveExecution;

  /// No description provided for @approvalPlanTitle.
  ///
  /// In en, this message translates to:
  /// **'Plan approval'**
  String get approvalPlanTitle;

  /// No description provided for @approvalUserRequest.
  ///
  /// In en, this message translates to:
  /// **'User request'**
  String get approvalUserRequest;

  /// No description provided for @approvalAnalysis.
  ///
  /// In en, this message translates to:
  /// **'Analysis'**
  String get approvalAnalysis;

  /// No description provided for @approvalPlan.
  ///
  /// In en, this message translates to:
  /// **'Plan'**
  String get approvalPlan;

  /// No description provided for @approvalToolReadTitle.
  ///
  /// In en, this message translates to:
  /// **'Tool read approval'**
  String get approvalToolReadTitle;

  /// No description provided for @approvalBashTitle.
  ///
  /// In en, this message translates to:
  /// **'Bash execution approval'**
  String get approvalBashTitle;

  /// No description provided for @approvalNeedsClarification.
  ///
  /// In en, this message translates to:
  /// **'Clarification needed'**
  String get approvalNeedsClarification;

  /// No description provided for @approvalClarificationPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous question'**
  String get approvalClarificationPrevious;

  /// No description provided for @approvalClarificationNext.
  ///
  /// In en, this message translates to:
  /// **'Next question'**
  String get approvalClarificationNext;

  /// No description provided for @approvalClarificationRecommended.
  ///
  /// In en, this message translates to:
  /// **'Recommended'**
  String get approvalClarificationRecommended;

  /// No description provided for @approvalClarificationCompleteSelection.
  ///
  /// In en, this message translates to:
  /// **'Complete selection'**
  String get approvalClarificationCompleteSelection;

  /// No description provided for @approvalSeverityCritical.
  ///
  /// In en, this message translates to:
  /// **'Critical'**
  String get approvalSeverityCritical;

  /// No description provided for @approvalSeverityHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get approvalSeverityHigh;

  /// No description provided for @approvalSeverityMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get approvalSeverityMedium;

  /// No description provided for @approvalSeverityLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get approvalSeverityLow;

  /// No description provided for @approvalSkip.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get approvalSkip;

  /// No description provided for @approvalYes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get approvalYes;

  /// No description provided for @approvalImplementPlan.
  ///
  /// In en, this message translates to:
  /// **'Implementation plan'**
  String get approvalImplementPlan;

  /// No description provided for @approvalLastRunFailed.
  ///
  /// In en, this message translates to:
  /// **'Last run failed'**
  String get approvalLastRunFailed;

  /// No description provided for @approvalIgnore.
  ///
  /// In en, this message translates to:
  /// **'Ignore'**
  String get approvalIgnore;

  /// No description provided for @approvalExecutePlan.
  ///
  /// In en, this message translates to:
  /// **'Execute plan ↵'**
  String get approvalExecutePlan;

  /// No description provided for @approvalSubmitEnter.
  ///
  /// In en, this message translates to:
  /// **'Submit ↵'**
  String get approvalSubmitEnter;

  /// No description provided for @composerAddImage.
  ///
  /// In en, this message translates to:
  /// **'Add image'**
  String get composerAddImage;

  /// No description provided for @composerVoiceInput.
  ///
  /// In en, this message translates to:
  /// **'Voice input'**
  String get composerVoiceInput;

  /// No description provided for @composerStopVoiceInput.
  ///
  /// In en, this message translates to:
  /// **'Stop voice input'**
  String get composerStopVoiceInput;

  /// No description provided for @composerNoSpeech.
  ///
  /// In en, this message translates to:
  /// **'No speech recognized'**
  String get composerNoSpeech;

  /// No description provided for @composerSendHint.
  ///
  /// In en, this message translates to:
  /// **'Send a message...'**
  String get composerSendHint;

  /// No description provided for @composerFollowUp.
  ///
  /// In en, this message translates to:
  /// **'Follow up'**
  String get composerFollowUp;

  /// No description provided for @composerRequestChanges.
  ///
  /// In en, this message translates to:
  /// **'Request changes'**
  String get composerRequestChanges;

  /// No description provided for @composerPendingImage.
  ///
  /// In en, this message translates to:
  /// **'Pending image {index}'**
  String composerPendingImage(int index);

  /// No description provided for @composerRemoveImage.
  ///
  /// In en, this message translates to:
  /// **'Remove image {index}'**
  String composerRemoveImage(int index);

  /// No description provided for @voiceListening.
  ///
  /// In en, this message translates to:
  /// **'Listening'**
  String get voiceListening;

  /// No description provided for @voiceTapToStop.
  ///
  /// In en, this message translates to:
  /// **'Tap anywhere when you are done'**
  String get voiceTapToStop;

  /// No description provided for @voiceStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get voiceStop;

  /// No description provided for @setupConnectPc.
  ///
  /// In en, this message translates to:
  /// **'Connect PC'**
  String get setupConnectPc;

  /// No description provided for @setupPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous'**
  String get setupPrevious;

  /// No description provided for @setupNext.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get setupNext;

  /// No description provided for @setupEnterApp.
  ///
  /// In en, this message translates to:
  /// **'Enter app'**
  String get setupEnterApp;

  /// No description provided for @setupTestConnection.
  ///
  /// In en, this message translates to:
  /// **'Test connection'**
  String get setupTestConnection;

  /// No description provided for @setupRetestConnection.
  ///
  /// In en, this message translates to:
  /// **'Test again'**
  String get setupRetestConnection;

  /// No description provided for @setupConnectionError.
  ///
  /// In en, this message translates to:
  /// **'Connection error'**
  String get setupConnectionError;

  /// No description provided for @setupRetryConnection.
  ///
  /// In en, this message translates to:
  /// **'Retry connection'**
  String get setupRetryConnection;

  /// No description provided for @setupCompleteServerFirst.
  ///
  /// In en, this message translates to:
  /// **'Configure the server first'**
  String get setupCompleteServerFirst;

  /// No description provided for @setupLogin.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get setupLogin;

  /// No description provided for @setupRegister.
  ///
  /// In en, this message translates to:
  /// **'Register'**
  String get setupRegister;

  /// No description provided for @setupEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get setupEmail;

  /// No description provided for @setupPassword.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get setupPassword;

  /// No description provided for @setupRegisterAndLogin.
  ///
  /// In en, this message translates to:
  /// **'Register and sign in'**
  String get setupRegisterAndLogin;

  /// No description provided for @setupPairingCode.
  ///
  /// In en, this message translates to:
  /// **'Pairing code'**
  String get setupPairingCode;

  /// No description provided for @setupPairingCodeHint.
  ///
  /// In en, this message translates to:
  /// **'8 characters'**
  String get setupPairingCodeHint;

  /// No description provided for @setupScan.
  ///
  /// In en, this message translates to:
  /// **'Scan'**
  String get setupScan;

  /// No description provided for @setupBind.
  ///
  /// In en, this message translates to:
  /// **'Pair'**
  String get setupBind;

  /// No description provided for @setupCompleteLoginFirst.
  ///
  /// In en, this message translates to:
  /// **'Sign in first'**
  String get setupCompleteLoginFirst;

  /// No description provided for @setupBindPcFirst.
  ///
  /// In en, this message translates to:
  /// **'Pair a PC first'**
  String get setupBindPcFirst;

  /// No description provided for @setupNoBoundDevices.
  ///
  /// In en, this message translates to:
  /// **'No paired devices'**
  String get setupNoBoundDevices;

  /// No description provided for @setupScanPcCode.
  ///
  /// In en, this message translates to:
  /// **'Scan the PC pairing code'**
  String get setupScanPcCode;

  /// No description provided for @setupScanPcCodeHint.
  ///
  /// In en, this message translates to:
  /// **'Generate a QR code from Connect on Desktop'**
  String get setupScanPcCodeHint;

  /// No description provided for @setupManualConfiguration.
  ///
  /// In en, this message translates to:
  /// **'Manual setup'**
  String get setupManualConfiguration;

  /// No description provided for @setupSelectPc.
  ///
  /// In en, this message translates to:
  /// **'Select PC'**
  String get setupSelectPc;

  /// No description provided for @setupSelectPcHint.
  ///
  /// In en, this message translates to:
  /// **'Select a Desktop to enter the app, or scan to pair a new device.'**
  String get setupSelectPcHint;

  /// No description provided for @setupCurrent.
  ///
  /// In en, this message translates to:
  /// **'Current'**
  String get setupCurrent;

  /// No description provided for @setupBound.
  ///
  /// In en, this message translates to:
  /// **'Paired'**
  String get setupBound;

  /// No description provided for @setupSelectOnlinePcFirst.
  ///
  /// In en, this message translates to:
  /// **'Select an online PC before entering the app'**
  String get setupSelectOnlinePcFirst;

  /// No description provided for @setupBindNewPc.
  ///
  /// In en, this message translates to:
  /// **'Pair new PC'**
  String get setupBindNewPc;

  /// No description provided for @pairingScanTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan pairing code'**
  String get pairingScanTitle;

  /// No description provided for @pairingScanHint.
  ///
  /// In en, this message translates to:
  /// **'Place the QR code from Connect on Desktop inside the frame'**
  String get pairingScanHint;

  /// No description provided for @pairingTorchOn.
  ///
  /// In en, this message translates to:
  /// **'Turn flashlight on'**
  String get pairingTorchOn;

  /// No description provided for @pairingTorchOff.
  ///
  /// In en, this message translates to:
  /// **'Turn flashlight off'**
  String get pairingTorchOff;

  /// No description provided for @setupWizardServerTitle.
  ///
  /// In en, this message translates to:
  /// **'Configure server'**
  String get setupWizardServerTitle;

  /// No description provided for @setupWizardLoginTitle.
  ///
  /// In en, this message translates to:
  /// **'Register / Sign in'**
  String get setupWizardLoginTitle;

  /// No description provided for @setupWizardBindTitle.
  ///
  /// In en, this message translates to:
  /// **'Pair PC'**
  String get setupWizardBindTitle;

  /// No description provided for @setupWizardSelectTitle.
  ///
  /// In en, this message translates to:
  /// **'Select PC'**
  String get setupWizardSelectTitle;

  /// No description provided for @setupWizardServerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the Center Server address and verify connectivity'**
  String get setupWizardServerSubtitle;

  /// No description provided for @setupWizardLoginSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in and register this phone as a mobile device'**
  String get setupWizardLoginSubtitle;

  /// No description provided for @setupWizardBindSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Generate a pairing code on Desktop, then scan or enter it'**
  String get setupWizardBindSubtitle;

  /// No description provided for @setupWizardSelectSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Select the PC you want to control remotely'**
  String get setupWizardSelectSubtitle;

  /// No description provided for @setupWizardServerShort.
  ///
  /// In en, this message translates to:
  /// **'Server'**
  String get setupWizardServerShort;

  /// No description provided for @setupWizardAccountShort.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get setupWizardAccountShort;

  /// No description provided for @setupWizardPairShort.
  ///
  /// In en, this message translates to:
  /// **'Pair'**
  String get setupWizardPairShort;

  /// No description provided for @setupStatusServerReachable.
  ///
  /// In en, this message translates to:
  /// **'Server reachable'**
  String get setupStatusServerReachable;

  /// No description provided for @setupStatusServerHelp.
  ///
  /// In en, this message translates to:
  /// **'Check the address, Wi-Fi, and whether Server listens on 0.0.0.0'**
  String get setupStatusServerHelp;

  /// No description provided for @setupStatusAccountDevice.
  ///
  /// In en, this message translates to:
  /// **'Account and mobile device'**
  String get setupStatusAccountDevice;

  /// No description provided for @setupStatusRegisteringDevice.
  ///
  /// In en, this message translates to:
  /// **'Registering this device...'**
  String get setupStatusRegisteringDevice;

  /// No description provided for @setupStatusLiveChannel.
  ///
  /// In en, this message translates to:
  /// **'Live channel (WebSocket)'**
  String get setupStatusLiveChannel;

  /// No description provided for @setupStatusCenterConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected to Center Server'**
  String get setupStatusCenterConnected;

  /// No description provided for @setupStatusConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting...'**
  String get setupStatusConnecting;

  /// No description provided for @setupStatusPairPc.
  ///
  /// In en, this message translates to:
  /// **'Pair PC'**
  String get setupStatusPairPc;

  /// No description provided for @setupStatusBoundCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 paired PC} other{{count} paired PCs}}'**
  String setupStatusBoundCount(int count);

  /// No description provided for @setupStatusPairHint.
  ///
  /// In en, this message translates to:
  /// **'Generate a pairing code on Desktop, then scan or enter it'**
  String get setupStatusPairHint;

  /// No description provided for @setupStatusSelectControlledPc.
  ///
  /// In en, this message translates to:
  /// **'Select PC to control'**
  String get setupStatusSelectControlledPc;

  /// No description provided for @setupStatusCheckingDevice.
  ///
  /// In en, this message translates to:
  /// **'{name} · Checking...'**
  String setupStatusCheckingDevice(Object name);

  /// No description provided for @setupStatusDeviceOnline.
  ///
  /// In en, this message translates to:
  /// **'{name} · Online'**
  String setupStatusDeviceOnline(Object name);

  /// No description provided for @setupStatusDeviceOffline.
  ///
  /// In en, this message translates to:
  /// **'{name} · Offline'**
  String setupStatusDeviceOffline(Object name);

  /// No description provided for @setupStatusDesktopOfflineHelp.
  ///
  /// In en, this message translates to:
  /// **'Desktop is offline. Confirm it is connected to the same Server.'**
  String get setupStatusDesktopOfflineHelp;

  /// No description provided for @setupStatusWebSocketDisconnected.
  ///
  /// In en, this message translates to:
  /// **'WebSocket is disconnected. Sign in again or pull to refresh.'**
  String get setupStatusWebSocketDisconnected;

  /// No description provided for @setupProgressTitle.
  ///
  /// In en, this message translates to:
  /// **'Connection progress'**
  String get setupProgressTitle;

  /// No description provided for @setupConnectedReady.
  ///
  /// In en, this message translates to:
  /// **'Connected. Select a PC to continue.'**
  String get setupConnectedReady;

  /// No description provided for @setupOpenedDevice.
  ///
  /// In en, this message translates to:
  /// **'Opened {name}'**
  String setupOpenedDevice(Object name);

  /// No description provided for @setupBoundDevice.
  ///
  /// In en, this message translates to:
  /// **'Paired {name}'**
  String setupBoundDevice(Object name);

  /// No description provided for @setupSelectedDevice.
  ///
  /// In en, this message translates to:
  /// **'Selected {name}'**
  String setupSelectedDevice(Object name);

  /// No description provided for @setupSelectedDeviceOffline.
  ///
  /// In en, this message translates to:
  /// **'{name} was selected but is currently offline'**
  String setupSelectedDeviceOffline(Object name);

  /// No description provided for @setupDeviceOfflineServerHelp.
  ///
  /// In en, this message translates to:
  /// **'{name} is offline. Confirm Desktop is connected to Server.'**
  String setupDeviceOfflineServerHelp(Object name);

  /// No description provided for @setupBoundDeviceOffline.
  ///
  /// In en, this message translates to:
  /// **'{name} was paired but is currently offline'**
  String setupBoundDeviceOffline(Object name);

  /// No description provided for @setupLegacyQr.
  ///
  /// In en, this message translates to:
  /// **'Legacy QR code. Sign in before pairing.'**
  String get setupLegacyQr;

  /// No description provided for @setupServerReachable.
  ///
  /// In en, this message translates to:
  /// **'Server is reachable'**
  String get setupServerReachable;

  /// No description provided for @setupServerUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server. Check the address and network.'**
  String get setupServerUnreachable;

  /// No description provided for @setupServerRequired.
  ///
  /// In en, this message translates to:
  /// **'Configure the server first'**
  String get setupServerRequired;

  /// No description provided for @setupLoginSuccess.
  ///
  /// In en, this message translates to:
  /// **'Signed in. WebSocket connected.'**
  String get setupLoginSuccess;

  /// No description provided for @setupReconnectAttempted.
  ///
  /// In en, this message translates to:
  /// **'Tried reconnecting WebSocket'**
  String get setupReconnectAttempted;

  /// No description provided for @setupBoundPcFallback.
  ///
  /// In en, this message translates to:
  /// **'Paired PC'**
  String get setupBoundPcFallback;

  /// No description provided for @composerWorkMode.
  ///
  /// In en, this message translates to:
  /// **'Work mode'**
  String get composerWorkMode;

  /// No description provided for @composerWorkModeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose how this session runs'**
  String get composerWorkModeSubtitle;

  /// No description provided for @composerMode.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get composerMode;

  /// No description provided for @composerBashApproval.
  ///
  /// In en, this message translates to:
  /// **'Bash approval'**
  String get composerBashApproval;

  /// No description provided for @composerBashApprovalSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Control confirmation before commands run'**
  String get composerBashApprovalSubtitle;

  /// No description provided for @bashReviewAlways.
  ///
  /// In en, this message translates to:
  /// **'Always confirm'**
  String get bashReviewAlways;

  /// No description provided for @bashReviewAlwaysDescription.
  ///
  /// In en, this message translates to:
  /// **'Ask before running commands or accessing paths outside the workspace'**
  String get bashReviewAlwaysDescription;

  /// No description provided for @bashReviewAuto.
  ///
  /// In en, this message translates to:
  /// **'Confirm risky actions'**
  String get bashReviewAuto;

  /// No description provided for @bashReviewAutoDescription.
  ///
  /// In en, this message translates to:
  /// **'Run low-risk actions automatically; still ask for risky commands or external paths'**
  String get bashReviewAutoDescription;

  /// No description provided for @bashReviewAllowAll.
  ///
  /// In en, this message translates to:
  /// **'Run automatically'**
  String get bashReviewAllowAll;

  /// No description provided for @bashReviewAllowAllDescription.
  ///
  /// In en, this message translates to:
  /// **'Skip confirmations while respecting the current mode, orchestration, and security policy'**
  String get bashReviewAllowAllDescription;

  /// No description provided for @composerSettings.
  ///
  /// In en, this message translates to:
  /// **'Composer settings'**
  String get composerSettings;

  /// No description provided for @composerOrchestrationSelection.
  ///
  /// In en, this message translates to:
  /// **'Orchestration'**
  String get composerOrchestrationSelection;

  /// No description provided for @activityToolIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Tool incomplete · {text}'**
  String activityToolIncomplete(Object text);

  /// No description provided for @activityReadFiles.
  ///
  /// In en, this message translates to:
  /// **'Read {count} files'**
  String activityReadFiles(Object count);

  /// No description provided for @activityWroteFiles.
  ///
  /// In en, this message translates to:
  /// **'Wrote {count} files'**
  String activityWroteFiles(Object count);

  /// No description provided for @activityEditedFiles.
  ///
  /// In en, this message translates to:
  /// **'Edited {count} files'**
  String activityEditedFiles(Object count);

  /// No description provided for @activitySearchedCode.
  ///
  /// In en, this message translates to:
  /// **'Searched code'**
  String get activitySearchedCode;

  /// No description provided for @activitySearchedCodeTimes.
  ///
  /// In en, this message translates to:
  /// **'Searched code {count} times'**
  String activitySearchedCodeTimes(Object count);

  /// No description provided for @activityRanCommands.
  ///
  /// In en, this message translates to:
  /// **'Ran {count} commands'**
  String activityRanCommands(Object count);

  /// No description provided for @activityCalledSubagents.
  ///
  /// In en, this message translates to:
  /// **'Called {count} subagents'**
  String activityCalledSubagents(Object count);

  /// No description provided for @activityRanTools.
  ///
  /// In en, this message translates to:
  /// **'Ran {count} tools'**
  String activityRanTools(Object count);

  /// No description provided for @activityCreatingTask.
  ///
  /// In en, this message translates to:
  /// **'Creating task'**
  String get activityCreatingTask;

  /// No description provided for @activityCreatedTask.
  ///
  /// In en, this message translates to:
  /// **'Created task'**
  String get activityCreatedTask;

  /// No description provided for @activityUpdatingTask.
  ///
  /// In en, this message translates to:
  /// **'Updating task'**
  String get activityUpdatingTask;

  /// No description provided for @activityUpdatedTask.
  ///
  /// In en, this message translates to:
  /// **'Updated task'**
  String get activityUpdatedTask;

  /// No description provided for @activityWriting.
  ///
  /// In en, this message translates to:
  /// **'Writing'**
  String get activityWriting;

  /// No description provided for @activityWrote.
  ///
  /// In en, this message translates to:
  /// **'Wrote'**
  String get activityWrote;

  /// No description provided for @activityEditing.
  ///
  /// In en, this message translates to:
  /// **'Editing'**
  String get activityEditing;

  /// No description provided for @activityEdited.
  ///
  /// In en, this message translates to:
  /// **'Edited'**
  String get activityEdited;

  /// No description provided for @activityReading.
  ///
  /// In en, this message translates to:
  /// **'Reading'**
  String get activityReading;

  /// No description provided for @activityRead.
  ///
  /// In en, this message translates to:
  /// **'Read'**
  String get activityRead;

  /// No description provided for @activitySearching.
  ///
  /// In en, this message translates to:
  /// **'Searching'**
  String get activitySearching;

  /// No description provided for @activitySearched.
  ///
  /// In en, this message translates to:
  /// **'Searched'**
  String get activitySearched;

  /// No description provided for @activityRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get activityRunning;

  /// No description provided for @activityRan.
  ///
  /// In en, this message translates to:
  /// **'Ran'**
  String get activityRan;

  /// No description provided for @activityCallingSubagent.
  ///
  /// In en, this message translates to:
  /// **'Calling subagent'**
  String get activityCallingSubagent;

  /// No description provided for @activityCalledSubagent.
  ///
  /// In en, this message translates to:
  /// **'Called subagent'**
  String get activityCalledSubagent;

  /// No description provided for @activityExecuting.
  ///
  /// In en, this message translates to:
  /// **'Executing'**
  String get activityExecuting;

  /// No description provided for @activityExecuted.
  ///
  /// In en, this message translates to:
  /// **'Executed'**
  String get activityExecuted;

  /// No description provided for @activityListPair.
  ///
  /// In en, this message translates to:
  /// **'{first} and {second}'**
  String activityListPair(Object first, Object second);

  /// No description provided for @activityListEnd.
  ///
  /// In en, this message translates to:
  /// **'{head}, and {last}'**
  String activityListEnd(Object head, Object last);

  /// No description provided for @activityProcessing.
  ///
  /// In en, this message translates to:
  /// **'Processing'**
  String get activityProcessing;

  /// No description provided for @activityProcessed.
  ///
  /// In en, this message translates to:
  /// **'Processed'**
  String get activityProcessed;

  /// No description provided for @activityExecutionProcess.
  ///
  /// In en, this message translates to:
  /// **'Execution process'**
  String get activityExecutionProcess;

  /// No description provided for @activityExecutionResult.
  ///
  /// In en, this message translates to:
  /// **'Execution result'**
  String get activityExecutionResult;

  /// No description provided for @activityFinalOutput.
  ///
  /// In en, this message translates to:
  /// **'Final output'**
  String get activityFinalOutput;

  /// No description provided for @activityExpandFull.
  ///
  /// In en, this message translates to:
  /// **'Show all'**
  String get activityExpandFull;

  /// No description provided for @activityClarificationAnswer.
  ///
  /// In en, this message translates to:
  /// **'Clarification answer'**
  String get activityClarificationAnswer;

  /// No description provided for @activityNoneSelected.
  ///
  /// In en, this message translates to:
  /// **'(Not selected)'**
  String get activityNoneSelected;

  /// No description provided for @activityThinking.
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get activityThinking;

  /// No description provided for @activityRunFailed.
  ///
  /// In en, this message translates to:
  /// **'Run failed{suffix}'**
  String activityRunFailed(Object suffix);

  /// No description provided for @activityRunningSuffix.
  ///
  /// In en, this message translates to:
  /// **'Running{suffix}'**
  String activityRunningSuffix(Object suffix);

  /// No description provided for @activityRanSuffix.
  ///
  /// In en, this message translates to:
  /// **'Ran{suffix}'**
  String activityRanSuffix(Object suffix);

  /// No description provided for @activityFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get activityFailed;

  /// No description provided for @activitySubagentTask.
  ///
  /// In en, this message translates to:
  /// **'{title} subagent task'**
  String activitySubagentTask(Object title);

  /// No description provided for @activityTaskGoal.
  ///
  /// In en, this message translates to:
  /// **'Task goal'**
  String get activityTaskGoal;

  /// No description provided for @activityWaitingMission.
  ///
  /// In en, this message translates to:
  /// **'Waiting for task instructions...'**
  String get activityWaitingMission;

  /// No description provided for @activityWaitingEvents.
  ///
  /// In en, this message translates to:
  /// **'Waiting for execution events...'**
  String get activityWaitingEvents;

  /// No description provided for @activityWorking.
  ///
  /// In en, this message translates to:
  /// **'Working'**
  String get activityWorking;

  /// No description provided for @activityCompressingContext.
  ///
  /// In en, this message translates to:
  /// **'Compressing context automatically'**
  String get activityCompressingContext;

  /// No description provided for @activityContextCompressed.
  ///
  /// In en, this message translates to:
  /// **'Context compressed automatically'**
  String get activityContextCompressed;

  /// No description provided for @activityContextCompressionFailed.
  ///
  /// In en, this message translates to:
  /// **'Context compression failed'**
  String get activityContextCompressionFailed;

  /// No description provided for @activityContextCompressionPaused.
  ///
  /// In en, this message translates to:
  /// **'Automatic context compression paused'**
  String get activityContextCompressionPaused;

  /// No description provided for @activityPromptCacheDrop.
  ///
  /// In en, this message translates to:
  /// **'Prompt cache hit rate dropped significantly'**
  String get activityPromptCacheDrop;

  /// No description provided for @activityPreparingRetry.
  ///
  /// In en, this message translates to:
  /// **'Preparing to retry'**
  String get activityPreparingRetry;

  /// No description provided for @activityRunDiagnostics.
  ///
  /// In en, this message translates to:
  /// **'Run diagnostics'**
  String get activityRunDiagnostics;

  /// No description provided for @activityAllowOutsideWorkspace.
  ///
  /// In en, this message translates to:
  /// **'Allow {tool} outside the workspace?'**
  String activityAllowOutsideWorkspace(Object tool);

  /// No description provided for @activityToolPermissionRequired.
  ///
  /// In en, this message translates to:
  /// **'Tool permission required'**
  String get activityToolPermissionRequired;

  /// No description provided for @activityReadSkill.
  ///
  /// In en, this message translates to:
  /// **'Read skill'**
  String get activityReadSkill;

  /// No description provided for @activityStartSubagent.
  ///
  /// In en, this message translates to:
  /// **'Start subagent'**
  String get activityStartSubagent;

  /// No description provided for @activityConnectionFailed.
  ///
  /// In en, this message translates to:
  /// **'Connection failed'**
  String get activityConnectionFailed;

  /// No description provided for @activityConnectionFailedHttp.
  ///
  /// In en, this message translates to:
  /// **'Connection failed · HTTP {status}'**
  String activityConnectionFailedHttp(Object status);

  /// No description provided for @activityReconnectAttempt.
  ///
  /// In en, this message translates to:
  /// **'Reconnect {attempt}/{max}'**
  String activityReconnectAttempt(Object attempt, Object max);

  /// No description provided for @roleVision.
  ///
  /// In en, this message translates to:
  /// **'Vision'**
  String get roleVision;

  /// No description provided for @roleExplore.
  ///
  /// In en, this message translates to:
  /// **'Explore'**
  String get roleExplore;

  /// No description provided for @roleArchitect.
  ///
  /// In en, this message translates to:
  /// **'Architect'**
  String get roleArchitect;

  /// No description provided for @roleCoder.
  ///
  /// In en, this message translates to:
  /// **'Coder'**
  String get roleCoder;

  /// No description provided for @roleReviewer.
  ///
  /// In en, this message translates to:
  /// **'Reviewer'**
  String get roleReviewer;

  /// No description provided for @roleTester.
  ///
  /// In en, this message translates to:
  /// **'Tester'**
  String get roleTester;

  /// No description provided for @toolRead.
  ///
  /// In en, this message translates to:
  /// **'Read'**
  String get toolRead;

  /// No description provided for @toolWrite.
  ///
  /// In en, this message translates to:
  /// **'Write'**
  String get toolWrite;

  /// No description provided for @toolEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get toolEdit;

  /// No description provided for @toolSearch.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get toolSearch;

  /// No description provided for @toolFind.
  ///
  /// In en, this message translates to:
  /// **'Find'**
  String get toolFind;

  /// No description provided for @toolRunCommand.
  ///
  /// In en, this message translates to:
  /// **'Run command'**
  String get toolRunCommand;

  /// No description provided for @toolCall.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get toolCall;

  /// No description provided for @toolUpdateTasks.
  ///
  /// In en, this message translates to:
  /// **'Update tasks'**
  String get toolUpdateTasks;

  /// No description provided for @toolCreateTask.
  ///
  /// In en, this message translates to:
  /// **'Create task'**
  String get toolCreateTask;

  /// No description provided for @toolListTasks.
  ///
  /// In en, this message translates to:
  /// **'List tasks'**
  String get toolListTasks;

  /// No description provided for @toolReadTaskOutput.
  ///
  /// In en, this message translates to:
  /// **'Read task output'**
  String get toolReadTaskOutput;

  /// No description provided for @toolClarify.
  ///
  /// In en, this message translates to:
  /// **'Clarify'**
  String get toolClarify;

  /// No description provided for @toolWebSearch.
  ///
  /// In en, this message translates to:
  /// **'Search web'**
  String get toolWebSearch;

  /// No description provided for @toolWebFetch.
  ///
  /// In en, this message translates to:
  /// **'Fetch web page'**
  String get toolWebFetch;

  /// No description provided for @threadTasks.
  ///
  /// In en, this message translates to:
  /// **'Task progress'**
  String get threadTasks;

  /// No description provided for @threadCodeReview.
  ///
  /// In en, this message translates to:
  /// **'Code review'**
  String get threadCodeReview;

  /// No description provided for @threadCommitPush.
  ///
  /// In en, this message translates to:
  /// **'Commit and push'**
  String get threadCommitPush;

  /// No description provided for @threadStartFirstForTasks.
  ///
  /// In en, this message translates to:
  /// **'Start the session before viewing task progress'**
  String get threadStartFirstForTasks;

  /// No description provided for @threadSelectOrchestrationFirst.
  ///
  /// In en, this message translates to:
  /// **'Select an orchestration in Composer settings first'**
  String get threadSelectOrchestrationFirst;

  /// No description provided for @threadLoadingCommit.
  ///
  /// In en, this message translates to:
  /// **'Loading commit information...'**
  String get threadLoadingCommit;

  /// No description provided for @threadCommittedPushed.
  ///
  /// In en, this message translates to:
  /// **'Committed and pushed to remote'**
  String get threadCommittedPushed;

  /// No description provided for @threadPushed.
  ///
  /// In en, this message translates to:
  /// **'Pushed to remote'**
  String get threadPushed;

  /// No description provided for @threadCommitted.
  ///
  /// In en, this message translates to:
  /// **'Committed'**
  String get threadCommitted;

  /// No description provided for @threadPullBehind.
  ///
  /// In en, this message translates to:
  /// **'Pull ({count} behind)'**
  String threadPullBehind(Object count);

  /// No description provided for @threadFetch.
  ///
  /// In en, this message translates to:
  /// **'Fetch'**
  String get threadFetch;

  /// No description provided for @threadPulling.
  ///
  /// In en, this message translates to:
  /// **'Pulling...'**
  String get threadPulling;

  /// No description provided for @threadPullConflictDesktop.
  ///
  /// In en, this message translates to:
  /// **'Pull conflict. Resolve it on Desktop.'**
  String get threadPullConflictDesktop;

  /// No description provided for @threadPullConflictFiles.
  ///
  /// In en, this message translates to:
  /// **'Pull conflicts: {files}'**
  String threadPullConflictFiles(Object files);

  /// No description provided for @threadPullSuccess.
  ///
  /// In en, this message translates to:
  /// **'Pulled successfully'**
  String get threadPullSuccess;

  /// No description provided for @threadAlreadySynced.
  ///
  /// In en, this message translates to:
  /// **'The current branch is up to date'**
  String get threadAlreadySynced;

  /// No description provided for @threadFetching.
  ///
  /// In en, this message translates to:
  /// **'Fetching...'**
  String get threadFetching;

  /// No description provided for @threadFetchComplete.
  ///
  /// In en, this message translates to:
  /// **'Fetch complete'**
  String get threadFetchComplete;

  /// No description provided for @threadTaskListEmpty.
  ///
  /// In en, this message translates to:
  /// **'No task list'**
  String get threadTaskListEmpty;

  /// No description provided for @threadTaskInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get threadTaskInProgress;

  /// No description provided for @threadTaskCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get threadTaskCompleted;

  /// No description provided for @threadTaskBlocked.
  ///
  /// In en, this message translates to:
  /// **'Blocked'**
  String get threadTaskBlocked;

  /// No description provided for @threadTaskStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get threadTaskStopped;

  /// No description provided for @threadTaskPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get threadTaskPending;

  /// No description provided for @threadDesktopDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Desktop is not connected'**
  String get threadDesktopDisconnected;

  /// No description provided for @threadNpmScriptsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No package.json scripts found'**
  String get threadNpmScriptsEmpty;

  /// No description provided for @threadNpmScriptsSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search scripts'**
  String get threadNpmScriptsSearchHint;

  /// No description provided for @threadNpmScriptsNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No matching scripts'**
  String get threadNpmScriptsNoMatches;

  /// No description provided for @threadExtraArgs.
  ///
  /// In en, this message translates to:
  /// **'Extra arguments'**
  String get threadExtraArgs;

  /// No description provided for @threadExtraArgsValue.
  ///
  /// In en, this message translates to:
  /// **'Extra arguments: {args}'**
  String threadExtraArgsValue(Object args);

  /// No description provided for @threadRun.
  ///
  /// In en, this message translates to:
  /// **'Run'**
  String get threadRun;

  /// No description provided for @threadRunStarting.
  ///
  /// In en, this message translates to:
  /// **'Starting'**
  String get threadRunStarting;

  /// No description provided for @threadRunRunning.
  ///
  /// In en, this message translates to:
  /// **'Running'**
  String get threadRunRunning;

  /// No description provided for @threadRunCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get threadRunCompleted;

  /// No description provided for @threadRunFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get threadRunFailed;

  /// No description provided for @threadRunStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get threadRunStopped;

  /// No description provided for @threadStopping.
  ///
  /// In en, this message translates to:
  /// **'Stopping'**
  String get threadStopping;

  /// No description provided for @threadStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get threadStop;

  /// No description provided for @threadWaitingCommandOutput.
  ///
  /// In en, this message translates to:
  /// **'Waiting for command output from Desktop...'**
  String get threadWaitingCommandOutput;

  /// No description provided for @threadOutputTruncated.
  ///
  /// In en, this message translates to:
  /// **'Output is too long. Only the latest content is shown.'**
  String get threadOutputTruncated;

  /// No description provided for @threadDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete session'**
  String get threadDelete;

  /// No description provided for @threadDeleteConfirm.
  ///
  /// In en, this message translates to:
  /// **'Delete “{title}”? This cannot be undone.'**
  String threadDeleteConfirm(Object title);

  /// No description provided for @threadDeleted.
  ///
  /// In en, this message translates to:
  /// **'Session deleted'**
  String get threadDeleted;

  /// No description provided for @threadEditGuidanceHint.
  ///
  /// In en, this message translates to:
  /// **'Edit guidance message...'**
  String get threadEditGuidanceHint;

  /// No description provided for @threadProjectionLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading run projection...'**
  String get threadProjectionLoading;

  /// No description provided for @threadProjectionUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Run projection is not ready'**
  String get threadProjectionUnavailable;

  /// No description provided for @threadNoSubagentDetails.
  ///
  /// In en, this message translates to:
  /// **'No subagent details'**
  String get threadNoSubagentDetails;

  /// No description provided for @threadNoToolDetails.
  ///
  /// In en, this message translates to:
  /// **'No tool details'**
  String get threadNoToolDetails;

  /// No description provided for @threadRequestingDetails.
  ///
  /// In en, this message translates to:
  /// **'Requesting details...'**
  String get threadRequestingDetails;

  /// No description provided for @threadDetailsFailed.
  ///
  /// In en, this message translates to:
  /// **'Details request failed'**
  String get threadDetailsFailed;

  /// No description provided for @threadNoDetailsResponse.
  ///
  /// In en, this message translates to:
  /// **'No details response received'**
  String get threadNoDetailsResponse;

  /// No description provided for @threadZeroDetails.
  ///
  /// In en, this message translates to:
  /// **'Desktop returned 0 detail records'**
  String get threadZeroDetails;

  /// No description provided for @threadDetailsUnparseable.
  ///
  /// In en, this message translates to:
  /// **'The request was sent, but no parseable detail result was received.'**
  String get threadDetailsUnparseable;

  /// No description provided for @threadDetailsComplete.
  ///
  /// In en, this message translates to:
  /// **'Request completed, kind={kind}, key={key}.'**
  String threadDetailsComplete(Object key, Object kind);

  /// No description provided for @threadEditingGuidance.
  ///
  /// In en, this message translates to:
  /// **'Editing guidance message'**
  String get threadEditingGuidance;

  /// No description provided for @billingTitle.
  ///
  /// In en, this message translates to:
  /// **'Billing'**
  String get billingTitle;

  /// No description provided for @billingSessionTotal.
  ///
  /// In en, this message translates to:
  /// **'Session total · Cost after Eco orchestration'**
  String get billingSessionTotal;

  /// No description provided for @billingComparison.
  ///
  /// In en, this message translates to:
  /// **'Cost comparison'**
  String get billingComparison;

  /// No description provided for @billingUnorchestrated.
  ///
  /// In en, this message translates to:
  /// **'Unorchestrated'**
  String get billingUnorchestrated;

  /// No description provided for @billingPlannerEstimate.
  ///
  /// In en, this message translates to:
  /// **'Estimated at {model} rates'**
  String billingPlannerEstimate(Object model);

  /// No description provided for @billingMainModelEstimate.
  ///
  /// In en, this message translates to:
  /// **'Estimated at main model rates'**
  String get billingMainModelEstimate;

  /// No description provided for @billingEco.
  ///
  /// In en, this message translates to:
  /// **'Eco coding'**
  String get billingEco;

  /// No description provided for @billingEcoSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Actual cost after Eco orchestration'**
  String get billingEcoSubtitle;

  /// No description provided for @billingSavings.
  ///
  /// In en, this message translates to:
  /// **'Savings'**
  String get billingSavings;

  /// No description provided for @billingTokenUsage.
  ///
  /// In en, this message translates to:
  /// **'Token usage'**
  String get billingTokenUsage;

  /// No description provided for @billingInput.
  ///
  /// In en, this message translates to:
  /// **'Input'**
  String get billingInput;

  /// No description provided for @billingOutput.
  ///
  /// In en, this message translates to:
  /// **'Output'**
  String get billingOutput;

  /// No description provided for @billingCacheHitRate.
  ///
  /// In en, this message translates to:
  /// **'Cache hit rate'**
  String get billingCacheHitRate;

  /// No description provided for @billingCacheRead.
  ///
  /// In en, this message translates to:
  /// **'Cache read'**
  String get billingCacheRead;

  /// No description provided for @billingCacheWrite.
  ///
  /// In en, this message translates to:
  /// **'Cache write'**
  String get billingCacheWrite;

  /// No description provided for @billingByModel.
  ///
  /// In en, this message translates to:
  /// **'By model'**
  String get billingByModel;

  /// No description provided for @billingContext.
  ///
  /// In en, this message translates to:
  /// **'Context'**
  String get billingContext;

  /// No description provided for @billingComposition.
  ///
  /// In en, this message translates to:
  /// **'Composition'**
  String get billingComposition;

  /// No description provided for @billingVsUnorchestrated.
  ///
  /// In en, this message translates to:
  /// **'vs. unorchestrated estimate'**
  String get billingVsUnorchestrated;

  /// No description provided for @billingNoComposition.
  ///
  /// In en, this message translates to:
  /// **'No composition details'**
  String get billingNoComposition;

  /// No description provided for @usageNoSavings.
  ///
  /// In en, this message translates to:
  /// **'No savings yet'**
  String get usageNoSavings;

  /// No description provided for @usageSavings.
  ///
  /// In en, this message translates to:
  /// **'Saved {cost}{percent}'**
  String usageSavings(Object cost, Object percent);

  /// No description provided for @usageFull.
  ///
  /// In en, this message translates to:
  /// **'100% full'**
  String get usageFull;

  /// No description provided for @usageNearLimit.
  ///
  /// In en, this message translates to:
  /// **'{percent}% near limit'**
  String usageNearLimit(Object percent);

  /// No description provided for @usageAlmostFull.
  ///
  /// In en, this message translates to:
  /// **'{percent}% almost full'**
  String usageAlmostFull(Object percent);

  /// No description provided for @usageUsed.
  ///
  /// In en, this message translates to:
  /// **'{percent}% used'**
  String usageUsed(Object percent);

  /// No description provided for @usageAccumulating.
  ///
  /// In en, this message translates to:
  /// **'Cost is accumulating...'**
  String get usageAccumulating;

  /// No description provided for @usagePlanHint.
  ///
  /// In en, this message translates to:
  /// **'Tokens and cost from planning will appear here.'**
  String get usagePlanHint;

  /// No description provided for @usageNoRecords.
  ///
  /// In en, this message translates to:
  /// **'No accumulated token or cost records.'**
  String get usageNoRecords;

  /// No description provided for @usageCostPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Cost — shown after the first model request'**
  String get usageCostPlaceholder;

  /// No description provided for @usageUpdatesPerResponse.
  ///
  /// In en, this message translates to:
  /// **'Usage updates after each model response'**
  String get usageUpdatesPerResponse;

  /// No description provided for @usagePlanUpdates.
  ///
  /// In en, this message translates to:
  /// **'Planning usage updates with model responses'**
  String get usagePlanUpdates;

  /// No description provided for @usageNoContext.
  ///
  /// In en, this message translates to:
  /// **'No context data'**
  String get usageNoContext;

  /// No description provided for @usageContextPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Context — shown after the first model request'**
  String get usageContextPlaceholder;

  /// No description provided for @diffNoChanges.
  ///
  /// In en, this message translates to:
  /// **'No uncommitted workspace changes'**
  String get diffNoChanges;

  /// No description provided for @diffTruncated.
  ///
  /// In en, this message translates to:
  /// **'The diff is long; some files may not be shown completely'**
  String get diffTruncated;

  /// No description provided for @diffFilesChanged.
  ///
  /// In en, this message translates to:
  /// **'{count} files changed'**
  String diffFilesChanged(Object count);

  /// No description provided for @diffNoContent.
  ///
  /// In en, this message translates to:
  /// **'No diff content'**
  String get diffNoContent;

  /// No description provided for @diffChange.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get diffChange;

  /// No description provided for @diffLine.
  ///
  /// In en, this message translates to:
  /// **'Line {start}'**
  String diffLine(int start);

  /// No description provided for @diffLineRange.
  ///
  /// In en, this message translates to:
  /// **'Lines {from}-{to}'**
  String diffLineRange(int from, int to);

  /// No description provided for @commitPushFailed.
  ///
  /// In en, this message translates to:
  /// **'Commit completed, but push failed: {error}'**
  String commitPushFailed(Object error);

  /// No description provided for @commitDestination.
  ///
  /// In en, this message translates to:
  /// **'Commit to'**
  String get commitDestination;

  /// No description provided for @commitNewBranch.
  ///
  /// In en, this message translates to:
  /// **'New branch'**
  String get commitNewBranch;

  /// No description provided for @commitCreateBranch.
  ///
  /// In en, this message translates to:
  /// **'Create branch'**
  String get commitCreateBranch;

  /// No description provided for @commitBranchName.
  ///
  /// In en, this message translates to:
  /// **'Branch name'**
  String get commitBranchName;

  /// No description provided for @commonCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get commonCreate;

  /// No description provided for @commitSelectModel.
  ///
  /// In en, this message translates to:
  /// **'Select generation model'**
  String get commitSelectModel;

  /// No description provided for @commitChanges.
  ///
  /// In en, this message translates to:
  /// **'Commit changes'**
  String get commitChanges;

  /// No description provided for @commitFilesSummary.
  ///
  /// In en, this message translates to:
  /// **'{count} files · +{additions} -{deletions}'**
  String commitFilesSummary(int count, int additions, int deletions);

  /// No description provided for @commitLoadingModels.
  ///
  /// In en, this message translates to:
  /// **'Loading models...'**
  String get commitLoadingModels;

  /// No description provided for @commitNoModel.
  ///
  /// In en, this message translates to:
  /// **'No model configured'**
  String get commitNoModel;

  /// No description provided for @commitMessageHint.
  ///
  /// In en, this message translates to:
  /// **'Commit message (leave blank to generate with AI)'**
  String get commitMessageHint;

  /// No description provided for @commitGenerateMessage.
  ///
  /// In en, this message translates to:
  /// **'Generate commit message with AI'**
  String get commitGenerateMessage;

  /// No description provided for @commitIncludeUnstaged.
  ///
  /// In en, this message translates to:
  /// **'Include unstaged changes'**
  String get commitIncludeUnstaged;

  /// No description provided for @commitCommitting.
  ///
  /// In en, this message translates to:
  /// **'Committing...'**
  String get commitCommitting;

  /// No description provided for @commitPushing.
  ///
  /// In en, this message translates to:
  /// **'Pushing...'**
  String get commitPushing;

  /// No description provided for @commitAndPush.
  ///
  /// In en, this message translates to:
  /// **'Commit and push'**
  String get commitAndPush;

  /// No description provided for @commitPushOnlyAhead.
  ///
  /// In en, this message translates to:
  /// **'Push only ({count} ahead)'**
  String commitPushOnlyAhead(Object count);

  /// No description provided for @composerReasoningOff.
  ///
  /// In en, this message translates to:
  /// **'Off'**
  String get composerReasoningOff;

  /// No description provided for @composerReasoningLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get composerReasoningLow;

  /// No description provided for @composerReasoningMedium.
  ///
  /// In en, this message translates to:
  /// **'Medium'**
  String get composerReasoningMedium;

  /// No description provided for @composerReasoningHigh.
  ///
  /// In en, this message translates to:
  /// **'High'**
  String get composerReasoningHigh;

  /// No description provided for @composerReasoningExtraHigh.
  ///
  /// In en, this message translates to:
  /// **'Extra high'**
  String get composerReasoningExtraHigh;

  /// No description provided for @composerReasoningMaximum.
  ///
  /// In en, this message translates to:
  /// **'Maximum'**
  String get composerReasoningMaximum;

  /// No description provided for @composerNoSubagents.
  ///
  /// In en, this message translates to:
  /// **'The current orchestration has no subagents'**
  String get composerNoSubagents;

  /// No description provided for @composerOrchestrationNotConfigured.
  ///
  /// In en, this message translates to:
  /// **'Orchestration not configured'**
  String get composerOrchestrationNotConfigured;

  /// No description provided for @composerModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get composerModel;

  /// No description provided for @composerAuxiliaryModel.
  ///
  /// In en, this message translates to:
  /// **'Auxiliary model'**
  String get composerAuxiliaryModel;

  /// No description provided for @composerAuxiliaryModelHint.
  ///
  /// In en, this message translates to:
  /// **'Used for title generation and automatic command approval'**
  String get composerAuxiliaryModelHint;

  /// No description provided for @composerAuxiliaryModelManualFallback.
  ///
  /// In en, this message translates to:
  /// **'Sending remains available; titles are not generated and reviews use manual mode'**
  String get composerAuxiliaryModelManualFallback;

  /// No description provided for @composerAuxiliaryModelNeedsMainAgent.
  ///
  /// In en, this message translates to:
  /// **'Configure the main Agent before selecting an auxiliary model'**
  String get composerAuxiliaryModelNeedsMainAgent;

  /// No description provided for @auxiliaryModelRequiredForAutoReview.
  ///
  /// In en, this message translates to:
  /// **'Configure an auxiliary model before enabling automatic reviews'**
  String get auxiliaryModelRequiredForAutoReview;

  /// No description provided for @auxiliaryModelAutoReviewFallback.
  ///
  /// In en, this message translates to:
  /// **'No auxiliary model is configured. Switched to manual review and continued sending'**
  String get auxiliaryModelAutoReviewFallback;

  /// No description provided for @composerReasoning.
  ///
  /// In en, this message translates to:
  /// **'Reasoning'**
  String get composerReasoning;

  /// No description provided for @composerOrchestration.
  ///
  /// In en, this message translates to:
  /// **'Orchestration'**
  String get composerOrchestration;

  /// No description provided for @composerSubagents.
  ///
  /// In en, this message translates to:
  /// **'Subagents'**
  String get composerSubagents;

  /// No description provided for @composerOrchestrationComponents.
  ///
  /// In en, this message translates to:
  /// **'Orchestration components'**
  String get composerOrchestrationComponents;

  /// No description provided for @composerSessionOnly.
  ///
  /// In en, this message translates to:
  /// **'Settings apply only to this session'**
  String get composerSessionOnly;

  /// No description provided for @composerRuntimeCore.
  ///
  /// In en, this message translates to:
  /// **'Runtime core'**
  String get composerRuntimeCore;

  /// No description provided for @composerRuntimeCoreLocked.
  ///
  /// In en, this message translates to:
  /// **'The runtime core is locked for this session'**
  String get composerRuntimeCoreLocked;

  /// No description provided for @composerOrchestrationLocked.
  ///
  /// In en, this message translates to:
  /// **'Orchestration cannot be edited for this session'**
  String get composerOrchestrationLocked;

  /// No description provided for @composerMainAgent.
  ///
  /// In en, this message translates to:
  /// **'Main Agent'**
  String get composerMainAgent;

  /// No description provided for @composerMainAgentPrompt.
  ///
  /// In en, this message translates to:
  /// **'Prompt'**
  String get composerMainAgentPrompt;

  /// No description provided for @composerBuiltinMainAgentPrompt.
  ///
  /// In en, this message translates to:
  /// **'Follow built-in agent prompt'**
  String get composerBuiltinMainAgentPrompt;

  /// No description provided for @composerNoSubagentOrchestration.
  ///
  /// In en, this message translates to:
  /// **'No subagents'**
  String get composerNoSubagentOrchestration;

  /// No description provided for @composerAgentsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} agents'**
  String composerAgentsCount(int count);

  /// No description provided for @composerAlwaysEnabled.
  ///
  /// In en, this message translates to:
  /// **'Always enabled'**
  String get composerAlwaysEnabled;

  /// No description provided for @composerMcpDisabledHint.
  ///
  /// In en, this message translates to:
  /// **'When disabled, this session will not call tools from this server'**
  String get composerMcpDisabledHint;

  /// No description provided for @composerNoSwitchableAgent.
  ///
  /// In en, this message translates to:
  /// **'No switchable Agent is available for this session'**
  String get composerNoSwitchableAgent;

  /// No description provided for @composerNoSwitchableModel.
  ///
  /// In en, this message translates to:
  /// **'The current orchestration has no switchable models'**
  String get composerNoSwitchableModel;

  /// No description provided for @composerNoReasoningOptions.
  ///
  /// In en, this message translates to:
  /// **'The current orchestration has no reasoning options'**
  String get composerNoReasoningOptions;

  /// No description provided for @composerNoOrchestrationResources.
  ///
  /// In en, this message translates to:
  /// **'No orchestration resources available'**
  String get composerNoOrchestrationResources;

  /// No description provided for @composerNoMcpServers.
  ///
  /// In en, this message translates to:
  /// **'No MCP servers configured'**
  String get composerNoMcpServers;

  /// No description provided for @composerNoSkills.
  ///
  /// In en, this message translates to:
  /// **'No Skills available for this project'**
  String get composerNoSkills;

  /// No description provided for @composerSkillsHint.
  ///
  /// In en, this message translates to:
  /// **'Enable available project Skills as needed'**
  String get composerSkillsHint;

  /// No description provided for @composerProjectSkill.
  ///
  /// In en, this message translates to:
  /// **'Project · {layout}'**
  String composerProjectSkill(Object layout);

  /// No description provided for @composerUserSkill.
  ///
  /// In en, this message translates to:
  /// **'User · {layout}'**
  String composerUserSkill(Object layout);

  /// No description provided for @composerNotEnabled.
  ///
  /// In en, this message translates to:
  /// **'Not enabled'**
  String get composerNotEnabled;

  /// No description provided for @composerModelCandidatesHint.
  ///
  /// In en, this message translates to:
  /// **'Only models from the selected main-agent provider are shown'**
  String get composerModelCandidatesHint;

  /// No description provided for @composerModelLocked.
  ///
  /// In en, this message translates to:
  /// **'Models cannot be switched for this session'**
  String get composerModelLocked;

  /// No description provided for @composerFollowOrchestration.
  ///
  /// In en, this message translates to:
  /// **'Follow orchestration'**
  String get composerFollowOrchestration;

  /// No description provided for @composerModelLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to load candidate models'**
  String get composerModelLoadFailed;

  /// No description provided for @composerReasoningUnsupported.
  ///
  /// In en, this message translates to:
  /// **'The current model does not support reasoning'**
  String get composerReasoningUnsupported;

  /// No description provided for @composerSessionReasoningOnly.
  ///
  /// In en, this message translates to:
  /// **'Affects only this session'**
  String get composerSessionReasoningOnly;

  /// No description provided for @composerSelectOrchestration.
  ///
  /// In en, this message translates to:
  /// **'Select orchestration'**
  String get composerSelectOrchestration;

  /// No description provided for @composerSelectOrchestrationSelection.
  ///
  /// In en, this message translates to:
  /// **'Select orchestration'**
  String get composerSelectOrchestrationSelection;

  /// No description provided for @composerOrchestrationSummary.
  ///
  /// In en, this message translates to:
  /// **'Orchestration {summary}'**
  String composerOrchestrationSummary(Object summary);

  /// No description provided for @composerSubagentOrchestration.
  ///
  /// In en, this message translates to:
  /// **'Subagent orchestration'**
  String get composerSubagentOrchestration;

  /// No description provided for @composerSubagentOrchestrationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Control which subagents this session can call'**
  String get composerSubagentOrchestrationSubtitle;

  /// No description provided for @composerAgents.
  ///
  /// In en, this message translates to:
  /// **'Agents'**
  String get composerAgents;

  /// No description provided for @composerContext.
  ///
  /// In en, this message translates to:
  /// **'Context'**
  String get composerContext;

  /// No description provided for @followUpReorder.
  ///
  /// In en, this message translates to:
  /// **'Drag to reorder messages'**
  String get followUpReorder;

  /// No description provided for @followUpGuide.
  ///
  /// In en, this message translates to:
  /// **'Guide'**
  String get followUpGuide;

  /// No description provided for @followUpEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get followUpEdit;

  /// No description provided for @followUpDeleting.
  ///
  /// In en, this message translates to:
  /// **'Deleting...'**
  String get followUpDeleting;

  /// No description provided for @followUpQueuedGuidance.
  ///
  /// In en, this message translates to:
  /// **'Queued guidance messages'**
  String get followUpQueuedGuidance;

  /// No description provided for @followUpImages.
  ///
  /// In en, this message translates to:
  /// **'{count} images'**
  String followUpImages(Object count);

  /// No description provided for @followUpEmptyGuidance.
  ///
  /// In en, this message translates to:
  /// **'Empty guidance message'**
  String get followUpEmptyGuidance;

  /// No description provided for @subagentElapsed.
  ///
  /// In en, this message translates to:
  /// **'Elapsed {duration}'**
  String subagentElapsed(Object duration);

  /// No description provided for @bashApprovalRememberPrefix.
  ///
  /// In en, this message translates to:
  /// **'Yes, and don\'t ask again for commands beginning with '**
  String get bashApprovalRememberPrefix;

  /// No description provided for @bashApprovalDenyAdjust.
  ///
  /// In en, this message translates to:
  /// **'No, tell Eco how to adjust'**
  String get bashApprovalDenyAdjust;

  /// No description provided for @projectMoreThreads.
  ///
  /// In en, this message translates to:
  /// **'{count} more'**
  String projectMoreThreads(Object count);

  /// No description provided for @projectAwaitingApproval.
  ///
  /// In en, this message translates to:
  /// **'Awaiting approval'**
  String get projectAwaitingApproval;

  /// No description provided for @activityThinkingLabel.
  ///
  /// In en, this message translates to:
  /// **'Thinking'**
  String get activityThinkingLabel;

  /// No description provided for @activitySubagentFallback.
  ///
  /// In en, this message translates to:
  /// **'Subagent'**
  String get activitySubagentFallback;

  /// No description provided for @threadNpmScripts.
  ///
  /// In en, this message translates to:
  /// **'npm scripts'**
  String get threadNpmScripts;

  /// No description provided for @composerAgent.
  ///
  /// In en, this message translates to:
  /// **'Agent'**
  String get composerAgent;

  /// No description provided for @composerMcp.
  ///
  /// In en, this message translates to:
  /// **'MCP'**
  String get composerMcp;

  /// No description provided for @composerSkills.
  ///
  /// In en, this message translates to:
  /// **'Skills'**
  String get composerSkills;

  /// No description provided for @composerPlanMode.
  ///
  /// In en, this message translates to:
  /// **'Plan Mode'**
  String get composerPlanMode;

  /// No description provided for @composerBashReview.
  ///
  /// In en, this message translates to:
  /// **'Bash Review'**
  String get composerBashReview;

  /// No description provided for @errorInvalidServerScheme.
  ///
  /// In en, this message translates to:
  /// **'Center Server URL must use HTTP or HTTPS.'**
  String get errorInvalidServerScheme;

  /// No description provided for @errorDeviceCredentialsRequired.
  ///
  /// In en, this message translates to:
  /// **'Device credentials are required.'**
  String get errorDeviceCredentialsRequired;

  /// No description provided for @errorQuickPairQrOutdated.
  ///
  /// In en, this message translates to:
  /// **'The QR code is missing server or authorization information. Generate a new code from the latest Desktop app.'**
  String get errorQuickPairQrOutdated;

  /// No description provided for @errorServerUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Cannot reach the server. Check the address and network.'**
  String get errorServerUnreachable;

  /// No description provided for @errorWebSocketDisconnected.
  ///
  /// In en, this message translates to:
  /// **'WebSocket is not connected.'**
  String get errorWebSocketDisconnected;

  /// No description provided for @errorRpcTimeout.
  ///
  /// In en, this message translates to:
  /// **'The Desktop request timed out.'**
  String get errorRpcTimeout;

  /// No description provided for @errorServerUrlRequired.
  ///
  /// In en, this message translates to:
  /// **'Center Server URL is required.'**
  String get errorServerUrlRequired;

  /// No description provided for @errorConnectionAborted.
  ///
  /// In en, this message translates to:
  /// **'Connection was cancelled.'**
  String get errorConnectionAborted;

  /// No description provided for @errorWebSocketTimeout.
  ///
  /// In en, this message translates to:
  /// **'WebSocket connection timed out.'**
  String get errorWebSocketTimeout;

  /// No description provided for @errorRpcFailed.
  ///
  /// In en, this message translates to:
  /// **'The Desktop request failed.'**
  String get errorRpcFailed;

  /// No description provided for @errorDeviceCredentialsMissing.
  ///
  /// In en, this message translates to:
  /// **'Device credentials are missing.'**
  String get errorDeviceCredentialsMissing;

  /// No description provided for @errorServerOutdated.
  ///
  /// In en, this message translates to:
  /// **'The Server is too old for QR connection. Rebuild and deploy Center Server with docker compose up -d --build.'**
  String get errorServerOutdated;

  /// No description provided for @errorHttpRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Request failed with HTTP {status}.'**
  String errorHttpRequestFailed(Object status);

  /// No description provided for @errorNetworkRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Network request failed.'**
  String get errorNetworkRequestFailed;

  /// No description provided for @errorInvalidPairQr.
  ///
  /// In en, this message translates to:
  /// **'Invalid pairing QR code.'**
  String get errorInvalidPairQr;

  /// No description provided for @authNetwork.
  ///
  /// In en, this message translates to:
  /// **'Cannot connect to the server. Check your network and try again.'**
  String get authNetwork;

  /// No description provided for @authDeviceInactive.
  ///
  /// In en, this message translates to:
  /// **'This device was removed or disabled on the server. Configure the connection again.'**
  String get authDeviceInactive;

  /// No description provided for @authAccountUnusable.
  ///
  /// In en, this message translates to:
  /// **'This account is disabled. Contact an administrator.'**
  String get authAccountUnusable;

  /// No description provided for @authRelogin.
  ///
  /// In en, this message translates to:
  /// **'Your session expired. Sign in again.'**
  String get authRelogin;

  /// No description provided for @authUnknown.
  ///
  /// In en, this message translates to:
  /// **'Connection failed. Try again later.'**
  String get authUnknown;

  /// No description provided for @signOutCleanupFailed.
  ///
  /// In en, this message translates to:
  /// **'Signed out locally, but server cleanup did not complete: {message}'**
  String signOutCleanupFailed(Object message);

  /// No description provided for @speechPermissionDenied.
  ///
  /// In en, this message translates to:
  /// **'Microphone and speech recognition permissions are required'**
  String get speechPermissionDenied;

  /// No description provided for @speechUnavailable.
  ///
  /// In en, this message translates to:
  /// **'System speech recognition is unavailable on this device'**
  String get speechUnavailable;

  /// No description provided for @speechBusy.
  ///
  /// In en, this message translates to:
  /// **'The previous speech recognition request is still running'**
  String get speechBusy;

  /// No description provided for @speechNetworkUnavailable.
  ///
  /// In en, this message translates to:
  /// **'System speech recognition is temporarily unavailable'**
  String get speechNetworkUnavailable;

  /// No description provided for @speechRecognitionFailed.
  ///
  /// In en, this message translates to:
  /// **'Speech recognition failed'**
  String get speechRecognitionFailed;

  /// No description provided for @landingOpenProject.
  ///
  /// In en, this message translates to:
  /// **'Open a project to start coding'**
  String get landingOpenProject;

  /// No description provided for @landingHomePrompt.
  ///
  /// In en, this message translates to:
  /// **'What are you working on?'**
  String get landingHomePrompt;

  /// No description provided for @landingProjectPrompt.
  ///
  /// In en, this message translates to:
  /// **'What should we build in {name}?'**
  String landingProjectPrompt(Object name);

  /// No description provided for @composerLandingPlaceholder.
  ///
  /// In en, this message translates to:
  /// **'Ask anything'**
  String get composerLandingPlaceholder;

  /// No description provided for @threadProjectionNoPcSelected.
  ///
  /// In en, this message translates to:
  /// **'Select a PC before requesting projection details'**
  String get threadProjectionNoPcSelected;

  /// No description provided for @threadEarlierHistoryLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed to load earlier conversation history. Pull down at the top to retry.'**
  String get threadEarlierHistoryLoadFailed;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
