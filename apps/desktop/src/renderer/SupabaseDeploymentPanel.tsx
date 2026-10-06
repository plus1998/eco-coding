import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudUpload,
  Code2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SupabaseDeploymentConnection, SupabaseDeploymentSnapshot } from "../shared/supabase-deployment";
import { supabaseCloudProjectRef } from "../shared/supabase-deployment";

function requireDeploymentApi() {
  if (!window.eco) throw new Error("桌面 Supabase 部署接口不可用。");
  return window.eco;
}

function deploymentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}

type DeploymentActivity = "authorize" | "check" | "deploy" | "connect" | "forget";

function SupabaseMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" role="presentation" aria-hidden="true">
      <path d="M13.5 2 3 14h8v8l10-12h-7.5V2Z" fill="currentColor" />
    </svg>
  );
}

function DeploymentError({ title, message }: { title: string; message: string | null }) {
  return (
    <div className="cs-cloud-error" role="alert">
      <AlertCircle size={16} aria-hidden />
      <div>
        <strong>{title}</strong>
        {message ? <p>{message}</p> : null}
      </div>
    </div>
  );
}

export function SupabaseDeploymentPanel({
  projectUrl,
  disabled,
  onUseProject,
}: {
  projectUrl: string;
  disabled?: boolean | undefined;
  onUseProject: (connection: SupabaseDeploymentConnection) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<SupabaseDeploymentSnapshot>();
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState("");
  const [activity, setActivity] = useState<DeploymentActivity | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<{ message: string; activity: DeploymentActivity | "load" }>();
  const mounted = useRef(false);
  const inspectedProject = useRef<string | null>(null);
  const configuredRef = supabaseCloudProjectRef(projectUrl);
  const busy = activity !== null;

  useEffect(() => {
    mounted.current = true;
    const api = window.eco;
    if (!api?.getSupabaseDeployment) {
      setError({ message: t("settings.center.cloud.unavailable"), activity: "load" });
      return () => {
        mounted.current = false;
      };
    }
    const receive = (next: SupabaseDeploymentSnapshot) => {
      if (mounted.current) setSnapshot(next);
    };
    const unsubscribe = api.onSupabaseDeploymentChanged(receive);
    void api
      .getSupabaseDeployment()
      .then(receive)
      .catch((caught) => {
        if (mounted.current) setError({ message: deploymentErrorMessage(caught), activity: "load" });
      });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [t]);

  useEffect(() => {
    if (!snapshot?.authorized || selected || busy) return;
    const remembered = snapshot.job?.projectRef ?? snapshot.report?.projectRef;
    const project =
      snapshot.projects.find((entry) => entry.ref === remembered) ??
      snapshot.projects.find((entry) => entry.ref === configuredRef) ??
      snapshot.projects.find((entry) => entry.status === "ACTIVE_HEALTHY");
    if (project) setSelected(project.ref);
  }, [snapshot, selected, configuredRef, busy]);

  const authorized = snapshot?.authorized === true;
  const running = snapshot?.job?.state === "running";
  const locked = Boolean(disabled || busy || running);
  const report = snapshot?.report?.projectRef === selected ? snapshot.report : null;
  const job = snapshot?.job?.projectRef === selected ? snapshot.job : null;
  const project = snapshot?.projects.find((entry) => entry.ref === selected);
  const checking = activity === "check";
  const compatibleNewer = report?.action === "newer" && report.canConnect;
  const incompatibleNewer =
    report?.action === "newer" &&
    report.online !== null &&
    report.online.apiVersion > report.local.apiVersion;

  const run = useCallback(
    async (nextActivity: DeploymentActivity, operation: () => Promise<SupabaseDeploymentSnapshot>) => {
      setActivity(nextActivity);
      setError(undefined);
      try {
        const next = await operation();
        if (mounted.current) setSnapshot(next);
      } catch (caught) {
        if (mounted.current) setError({ message: deploymentErrorMessage(caught), activity: nextActivity });
      } finally {
        if (mounted.current) setActivity(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!authorized) {
      inspectedProject.current = null;
      return;
    }
    if (!selected || running || inspectedProject.current === selected) return;
    inspectedProject.current = selected;
    void run("check", () => requireDeploymentApi().inspectSupabaseDeployment(selected));
  }, [authorized, selected, running, run]);

  async function authorize() {
    const accessToken = token.trim();
    setToken("");
    setShowToken(false);
    await run("authorize", () => requireDeploymentApi().authorizeSupabaseDeployment(accessToken));
  }

  async function handleUseProject() {
    setActivity("connect");
    setError(undefined);
    try {
      const connection = await requireDeploymentApi().getSupabaseDeploymentConnection(selected);
      await onUseProject(connection);
    } catch (caught) {
      if (mounted.current) setError({ message: deploymentErrorMessage(caught), activity: "connect" });
    } finally {
      if (mounted.current) setActivity(null);
    }
  }

  return (
    <section className="cs-cloud cs-card" aria-labelledby="cs-cloud-title" aria-busy={locked}>
      <header className="cs-cloud-header">
        <span className="cs-cloud-brand">
          <SupabaseMark />
        </span>
        <div className="cs-cloud-heading">
          <h2 id="cs-cloud-title">{t("settings.center.cloud.title")}</h2>
          <p>{t("settings.center.cloud.description")}</p>
        </div>
        {authorized ? (
          <span className="cs-cloud-authorized">
            <ShieldCheck size={13} aria-hidden />
            {t("settings.center.cloud.authorized")}
          </span>
        ) : null}
      </header>
      {!snapshot && !error ? (
        <div className="cs-cloud-loading" role="status">
          <Loader2 size={16} className="spin" aria-hidden />
          {t("common.loading")}
        </div>
      ) : null}
      {snapshot && !authorized ? (
        <form
          className="cs-cloud-auth"
          onSubmit={(event) => {
            event.preventDefault();
            void authorize();
          }}
        >
          <div className="cs-cloud-content">
            <div>
              <div className="cs-cloud-field-heading">
                <label className="cs-field-label" htmlFor="cs-cloud-token">
                  Personal Access Token
                </label>
                <a
                  className="cs-cloud-link"
                  href="https://supabase.com/dashboard/account/tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings.center.cloud.createToken")}
                  <ArrowUpRight size={13} aria-hidden />
                </a>
              </div>
              <div className="cs-cloud-input-wrap">
                <KeyRound size={16} aria-hidden />
                <input
                  id="cs-cloud-token"
                  className="cs-input cs-cloud-input"
                  type={showToken ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  disabled={locked}
                  placeholder="sbp_…"
                  aria-describedby="cs-cloud-token-hint"
                  onChange={(event) => setToken(event.target.value)}
                />
                <button
                  className="cs-cloud-reveal"
                  type="button"
                  disabled={locked}
                  aria-label={t(
                    showToken ? "settings.center.cloud.hideToken" : "settings.center.cloud.showToken",
                  )}
                  aria-pressed={showToken}
                  onClick={() => setShowToken((shown) => !shown)}
                >
                  {showToken ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
                </button>
              </div>
            </div>
            <p className="cs-cloud-hint" id="cs-cloud-token-hint">
              {t("settings.center.cloud.tokenHint")}
            </p>
            {error ? (
              <DeploymentError
                title={t(`settings.center.cloud.error.${error.activity}`)}
                message={error.message}
              />
            ) : null}
          </div>
          <footer className="cs-cloud-footer">
            <a
              className="cs-cloud-link"
              href="https://supabase.com/dashboard/new/_"
              target="_blank"
              rel="noreferrer"
            >
              {t("settings.center.cloud.createProject")}
              <ArrowUpRight size={13} aria-hidden />
            </a>
            <button className="cs-btn cs-cloud-primary" type="submit" disabled={locked || !token.trim()}>
              {busy ? <Loader2 size={14} className="spin" aria-hidden /> : null}
              {t("settings.center.cloud.authorize")}
              {!busy ? <ArrowRight size={14} aria-hidden /> : null}
            </button>
          </footer>
        </form>
      ) : null}
      {authorized && snapshot ? (
        <div>
          <div className="cs-cloud-content">
            <div className="cs-cloud-project">
              <div className="cs-cloud-field-heading">
                <label className="cs-field-label" htmlFor="cs-cloud-project">
                  {t("settings.center.cloud.project")}
                </label>
                <button
                  className="cs-cloud-link"
                  type="button"
                  disabled={locked || !selected}
                  onClick={() =>
                    void run("check", () => requireDeploymentApi().inspectSupabaseDeployment(selected))
                  }
                >
                  <RefreshCw size={12} className={checking ? "spin" : ""} aria-hidden />
                  {t("settings.center.cloud.check")}
                </button>
              </div>
              <div className="cs-cloud-input-wrap">
                <Cloud size={16} aria-hidden />
                <select
                  id="cs-cloud-project"
                  className="cs-input cs-cloud-input cs-cloud-select"
                  value={selected}
                  disabled={locked || snapshot.projects.length === 0}
                  aria-describedby={project ? "cs-cloud-project-meta" : undefined}
                  onChange={(event) => {
                    setError(undefined);
                    setSelected(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    {t("settings.center.cloud.selectProject")}
                  </option>
                  {snapshot.projects.map((entry) => (
                    <option key={entry.ref} value={entry.ref} disabled={entry.status !== "ACTIVE_HEALTHY"}>
                      {entry.name} · {entry.ref}
                      {entry.status !== "ACTIVE_HEALTHY" ? ` · ${entry.status}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={15} className="cs-cloud-select-chevron" aria-hidden />
              </div>
              {project ? (
                <div className="cs-cloud-project-meta" id="cs-cloud-project-meta">
                  <span>{project.region}</span>
                  <a
                    className="cs-cloud-link"
                    href={`https://supabase.com/dashboard/project/${project.ref}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("settings.center.cloud.dashboard")}
                    <ArrowUpRight size={12} aria-hidden />
                  </a>
                </div>
              ) : null}
            </div>
            {snapshot.projects.length === 0 ? (
              <div className="cs-cloud-empty">
                <Cloud size={22} strokeWidth={1.5} aria-hidden />
                <p>{t("settings.center.cloud.noProjects")}</p>
                <a
                  className="cs-cloud-link"
                  href="https://supabase.com/dashboard/new/_"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("settings.center.cloud.createProject")}
                  <ArrowUpRight size={13} aria-hidden />
                </a>
              </div>
            ) : null}
            {checking && !report && !error ? (
              <div className="cs-cloud-loading" role="status">
                <Loader2 size={15} className="spin" aria-hidden />
                {t("settings.center.cloud.phase.checking")}
              </div>
            ) : null}
            {report ? (
              <div className="cs-cloud-overview" aria-live="polite">
                <div className="cs-cloud-status-row">
                  <span
                    className={`cs-cloud-status cs-cloud-status--${running ? "running" : compatibleNewer ? "compatible" : report.action}`}
                  >
                    {running ? (
                      <Loader2 size={12} className="spin" aria-hidden />
                    ) : report.action === "current" || compatibleNewer ? (
                      <Check size={12} aria-hidden />
                    ) : (
                      <span className="cs-cloud-status-dot" />
                    )}
                    {t(
                      `settings.center.cloud.status.${running ? "running" : compatibleNewer ? "newerCompatible" : report.action}`,
                    )}
                  </span>
                  <p>
                    {t(
                      running
                        ? "settings.center.cloud.runningHint"
                        : compatibleNewer
                          ? "settings.center.cloud.action.newerCompatible"
                          : incompatibleNewer
                            ? "settings.center.cloud.action.incompatibleApi"
                            : `settings.center.cloud.action.${report.action}`,
                      { online: report.online?.apiVersion, local: report.local.apiVersion },
                    )}
                  </p>
                </div>
                <div className="cs-cloud-versions">
                  <div className="cs-cloud-version">
                    <span className="cs-cloud-version-label">{t("settings.center.cloud.onlineVersion")}</span>
                    <strong className={report.online ? "is-release" : "is-unrecorded"}>
                      {report.online?.release ??
                        t(
                          report.onlineSchema
                            ? "settings.center.cloud.installed"
                            : "settings.center.cloud.notDeployed",
                        )}
                    </strong>
                    <span className="cs-cloud-version-note">
                      {report.onlineSchema && !report.online
                        ? t("settings.center.cloud.legacyVersion")
                        : t("settings.center.cloud.onlineHint")}
                    </span>
                  </div>
                  <span
                    className={`cs-cloud-version-arrow${report.action === "newer" && !compatibleNewer ? " is-blocked" : ""}`}
                    aria-hidden
                  >
                    {compatibleNewer ? (
                      <ShieldCheck size={14} />
                    ) : report.action === "newer" ? (
                      <AlertCircle size={14} />
                    ) : (
                      <ArrowRight size={14} />
                    )}
                  </span>
                  <div className="cs-cloud-version cs-cloud-version--target">
                    <span className="cs-cloud-version-label">{t("settings.center.cloud.targetVersion")}</span>
                    <strong className="is-release">{report.local.release}</strong>
                    <span className="cs-cloud-version-note">{t("settings.center.cloud.targetHint")}</span>
                  </div>
                </div>
                <details className="cs-cloud-details">
                  <summary>
                    <ChevronRight size={13} aria-hidden />
                    <span>{t("settings.center.cloud.details")}</span>
                    <span className="cs-cloud-details-meta">
                      {t(
                        report.pendingMigrations.length
                          ? "settings.center.cloud.pending"
                          : "settings.center.cloud.upToDateSummary",
                        { count: report.pendingMigrations.length, functions: report.functions.length },
                      )}
                    </span>
                  </summary>
                  <div className="cs-cloud-details-body">
                    <dl className="cs-cloud-technical">
                      <div>
                        <dt>{t("settings.center.cloud.apiVersion")}</dt>
                        <dd>
                          {report.online?.apiVersion ?? t("settings.center.cloud.unrecorded")}
                          <ArrowRight size={11} aria-hidden />
                          {report.local.apiVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("settings.center.cloud.schemaVersion")}</dt>
                        <dd>
                          {report.onlineSchema ?? "—"}
                          <ArrowRight size={11} aria-hidden />
                          {report.local.schema}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("settings.center.cloud.onlineFingerprint")}</dt>
                        <dd>{report.online?.hash.slice(0, 12) ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>{t("settings.center.cloud.targetFingerprint")}</dt>
                        <dd>{report.local.hash.slice(0, 12)}</dd>
                      </div>
                      {report.deployedByDesktopVersion ? (
                        <div>
                          <dt>{t("settings.center.cloud.deployedByDesktop")}</dt>
                          <dd>{report.deployedByDesktopVersion}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <p className="cs-cloud-config-note">
                      {report.configurationReady ? (
                        <ShieldCheck size={13} aria-hidden />
                      ) : (
                        <RefreshCw size={13} aria-hidden />
                      )}
                      {t(
                        report.configurationReady
                          ? "settings.center.cloud.configReady"
                          : "settings.center.cloud.configPending",
                      )}
                    </p>
                    <h3 className="cs-cloud-resource-title">
                      <Code2 size={14} aria-hidden />
                      {t("settings.center.cloud.functionVersions")}
                      <span>{report.functions.length}</span>
                    </h3>
                    <ul className="cs-cloud-functions">
                      {report.functions.map((fn) => (
                        <li key={fn.name}>
                          <span className="cs-cloud-function-name">{fn.name}</span>
                          <span
                            className={`cs-cloud-function-state${fn.status === "ACTIVE" ? " is-active" : ""}`}
                          >
                            <span className="cs-cloud-status-dot" aria-hidden />
                            {fn.version === null
                              ? t("settings.center.cloud.notDeployed")
                              : `v${fn.version} · ${fn.status}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </div>
            ) : null}
            {job?.state === "running" ? (
              <div className="cs-cloud-progress" role="status" aria-live="polite">
                <div className="cs-cloud-progress-heading">
                  <Loader2 size={14} className="spin" aria-hidden />
                  <strong>{t(`settings.center.cloud.phase.${job.phase}`)}</strong>
                  {job.total > 0 ? (
                    <span>
                      {job.completed} / {job.total}
                    </span>
                  ) : null}
                </div>
                {job.item ? <p className="cs-cloud-progress-item">{job.item}</p> : null}
                {job.total > 0 ? (
                  <progress
                    max={job.total}
                    value={job.completed}
                    aria-label={t("settings.center.cloud.progress")}
                  />
                ) : null}
              </div>
            ) : null}
            {job?.state === "failed" ? (
              <DeploymentError
                title={t("settings.center.cloud.failed", {
                  phase: t(`settings.center.cloud.phase.${job.phase}`),
                  item: job.item ?? "",
                })}
                message={job.error}
              />
            ) : null}
            {error ? (
              <DeploymentError
                title={t(`settings.center.cloud.error.${error.activity}`)}
                message={error.message}
              />
            ) : null}
            {job?.state === "succeeded" && report?.action === "current" ? (
              <p className="cs-cloud-success" role="status">
                <Check size={14} aria-hidden />
                {t("settings.center.cloud.success")}
              </p>
            ) : null}
          </div>
          <footer className="cs-cloud-footer">
            <button
              className="cs-cloud-link cs-cloud-forget"
              type="button"
              disabled={locked}
              onClick={() => {
                setSelected("");
                void run("forget", () => requireDeploymentApi().forgetSupabaseDeployment());
              }}
            >
              <LogOut size={13} aria-hidden />
              {t("settings.center.cloud.forget")}
            </button>
            {running || activity === "deploy" ? (
              <button className="cs-btn cs-cloud-primary" type="button" disabled>
                <Loader2 size={14} className="spin" aria-hidden />
                {t("settings.center.cloud.deploying")}
              </button>
            ) : report?.canConnect ? (
              <button
                className="cs-btn cs-cloud-primary"
                type="button"
                disabled={locked}
                onClick={() => void handleUseProject()}
              >
                {activity === "connect" ? <Loader2 size={14} className="spin" aria-hidden /> : null}
                {t("settings.center.cloud.useProject")}
                <ArrowRight size={14} aria-hidden />
              </button>
            ) : report?.action === "deploy" ||
              report?.action === "update" ||
              (job?.state === "failed" && report?.action !== "newer") ? (
              <button
                className="cs-btn cs-cloud-primary"
                type="button"
                disabled={locked || !selected}
                onClick={() =>
                  void run("deploy", () => requireDeploymentApi().runSupabaseDeployment(selected))
                }
              >
                <CloudUpload size={15} aria-hidden />
                {t(
                  job?.state === "failed"
                    ? "settings.center.cloud.retry"
                    : `settings.center.cloud.button.${report?.action}`,
                )}
              </button>
            ) : null}
          </footer>
        </div>
      ) : null}
      {!snapshot && error ? (
        <div className="cs-cloud-content">
          <DeploymentError
            title={t(`settings.center.cloud.error.${error.activity}`)}
            message={error.message}
          />
        </div>
      ) : null}
    </section>
  );
}
