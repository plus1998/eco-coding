import { AppWindow, Check, Download, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import type {
  SkillCatalogEntry,
  SkillCatalogSearchResult,
  SkillInfo,
  SkillLayout,
  SkillsListResult,
} from "../shared/skills";
import { SkillUninstallConfirmDialog } from "./SkillUninstallConfirmDialog";

const SKILL_LAYOUT_TABS: ReadonlyArray<{ layout: SkillLayout; label: string }> = [
  { layout: "agents", label: "Agents" },
  { layout: "codex", label: "Codex" },
  { layout: "claude", label: "Claude Code" },
];

interface SkillsSettingsPanelProps {
  snapshot?: SkillsListResult | undefined;
  loading?: boolean | undefined;
  onRefresh: () => void;
  onUninstall: (skill: SkillInfo) => Promise<void>;
  onLoadCatalogLeaderboard: () => Promise<SkillCatalogSearchResult>;
  onSearchCatalog: (query: string) => Promise<SkillCatalogSearchResult>;
  onInstallCatalog: (entry: SkillCatalogEntry, layout: SkillLayout) => Promise<void>;
}

export function SkillsSettingsPanel({
  snapshot,
  loading,
  onRefresh,
  onUninstall,
  onLoadCatalogLeaderboard,
  onSearchCatalog,
  onInstallCatalog,
}: SkillsSettingsPanelProps) {
  const [activeLayout, setActiveLayout] = useState<SkillLayout>("agents");
  const [pendingUninstall, setPendingUninstall] = useState<SkillInfo>();
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstallError, setUninstallError] = useState<string>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResult, setCatalogResult] = useState<SkillCatalogSearchResult>();
  const [leaderboardResult, setLeaderboardResult] = useState<SkillCatalogSearchResult>();
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string>();
  const [installingCatalogId, setInstallingCatalogId] = useState<string>();
  const skillsByLayout: Record<SkillLayout, SkillInfo[]> = {
    agents: [],
    codex: [],
    claude: [],
  };
  for (const skill of snapshot?.userSkills ?? []) {
    skillsByLayout[skill.layout].push(skill);
  }
  const visibleSkills = skillsByLayout[activeLayout].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const searchEntryIds = new Set(catalogResult?.entries.map((entry) => entry.id) ?? []);
  const leaderboardEntries = (leaderboardResult?.entries ?? [])
    .map((entry, index) => ({ entry, rank: index + 1 }))
    .filter(({ entry }) => !searchEntryIds.has(entry.id))
    .slice(0, catalogResult ? Math.max(0, 8 - catalogResult.entries.length) : 12);
  const openCatalog = () => {
    setCatalogOpen(true);
    if (leaderboardResult || leaderboardLoading) return;
    setLeaderboardLoading(true);
    setLeaderboardError(undefined);
    void onLoadCatalogLeaderboard()
      .then(setLeaderboardResult)
      .catch((error: unknown) =>
        setLeaderboardError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setLeaderboardLoading(false));
  };
  const renderCatalogEntry = (entry: SkillCatalogEntry, rank?: number) => {
    const installed = isCatalogSkillInstalled(skillsByLayout[activeLayout], entry);
    const installing = installingCatalogId === entry.id;
    return (
      <li key={entry.id} className="skills-catalog-card">
        {rank ? <span className="skills-catalog-rank">{rank}</span> : null}
        <a
          className="skills-catalog-card-main"
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          title={`在 skills.sh 查看 ${entry.source}/${entry.skillId}`}
        >
          <strong>{entry.name}</strong>
          <code>{entry.source}</code>
          <span>{formatInstallCount(entry.installs)} 次安装</span>
        </a>
        <button
          type="button"
          className="skills-catalog-install"
          disabled={installed || Boolean(installingCatalogId)}
          aria-label={installed ? `${entry.name} 已安装` : `安装 ${entry.name}`}
          title={installed ? "已安装" : installing ? "安装中" : "安装"}
          onClick={() => {
            setInstallingCatalogId(entry.id);
            setCatalogError(undefined);
            void onInstallCatalog(entry, activeLayout)
              .catch((error: unknown) =>
                setCatalogError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setInstallingCatalogId(undefined));
          }}
        >
          {installed ? <Check size={15} /> : <Download size={15} />}
        </button>
      </li>
    );
  };
  const catalogSearchForm = (
    <form
      className="skills-catalog-search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = catalogQuery.trim();
        if (query.length < 2 || catalogLoading) return;
        setCatalogLoading(true);
        setCatalogError(undefined);
        void onSearchCatalog(query)
          .then(setCatalogResult)
          .catch((error: unknown) => {
            setCatalogResult(undefined);
            setCatalogError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => setCatalogLoading(false));
      }}
    >
      <Search size={16} aria-hidden />
      <input
        type="search"
        value={catalogQuery}
        onChange={(event) => setCatalogQuery(event.target.value)}
        placeholder="搜索 skills.sh"
        aria-label="搜索 skills.sh"
        autoFocus
      />
      <button type="submit" disabled={catalogQuery.trim().length < 2 || catalogLoading}>
        {catalogLoading ? "搜…" : "搜"}
      </button>
    </form>
  );

  return (
    <>
      <header className="settings-page-header">
        <div className="settings-page-header-row">
          <div>
            <h1>Skills</h1>
          </div>
          <div className="skills-header-actions">
            <button
              type="button"
              className="settings-icon-button"
              onClick={openCatalog}
              aria-label="浏览 Skills 商店"
              title="浏览 Skills 商店"
            >
              <AppWindow size={18} />
            </button>
            <button
              type="button"
              className="settings-icon-button"
              onClick={onRefresh}
              disabled={loading}
              aria-label="刷新 Skills 列表"
            >
              <RefreshCw size={18} className={loading ? "spinning" : undefined} />
            </button>
          </div>
        </div>
      </header>

      {catalogOpen ? (
        <div className="settings-modal-backdrop" onClick={() => !installingCatalogId && setCatalogOpen(false)}>
          <section
            className="settings-modal skills-catalog-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skills-catalog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="settings-modal-header">
              <div>
                <h2 id="skills-catalog-title" className="settings-modal-title">
                  Skills 商店
                </h2>
                <p className="skills-catalog-modal-meta">
                  {catalogResult ? `${catalogResult.entries.length} 个搜索结果 · ` : "技能排行榜 · "}
                  安装到 {skillLayoutLabel(activeLayout)}
                </p>
              </div>
              <button
                type="button"
                className="settings-icon-button"
                aria-label="关闭 Skills 商店"
                disabled={Boolean(installingCatalogId)}
                onClick={() => setCatalogOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="settings-modal-body skills-catalog-modal-body">
              {catalogSearchForm}
              {catalogError ? <p className="settings-form-error">{catalogError}</p> : null}
              {catalogResult ? (
                <section className="skills-catalog-results-section">
                  <h3>搜索结果</h3>
                  {catalogResult.entries.length === 0 ? (
                    <p className="settings-empty-hint">没有找到匹配的 Skill。</p>
                  ) : (
                    <ul className="skills-catalog-grid">
                      {catalogResult.entries.map((entry) => renderCatalogEntry(entry))}
                    </ul>
                  )}
                </section>
              ) : null}
              {leaderboardError ? <p className="settings-form-error">{leaderboardError}</p> : null}
              {leaderboardLoading && leaderboardEntries.length === 0 ? (
                <p className="settings-empty-hint">正在加载技能排行榜…</p>
              ) : null}
              {leaderboardEntries.length > 0 ? (
                <section className="skills-catalog-results-section">
                  <h3>技能排行榜</h3>
                  <ul className="skills-catalog-grid">
                    {leaderboardEntries.map(({ entry, rank }) => renderCatalogEntry(entry, rank))}
                  </ul>
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <div className="models-settings-tabs" role="tablist" aria-label="Skills 来源">
        {SKILL_LAYOUT_TABS.map((tab) => (
          <button
            key={tab.layout}
            type="button"
            role="tab"
            aria-selected={activeLayout === tab.layout}
            aria-controls="skills-source-panel"
            className={activeLayout === tab.layout ? "models-settings-tab active" : "models-settings-tab"}
            onClick={() => setActiveLayout(tab.layout)}
          >
            {tab.label} {skillsByLayout[tab.layout].length}
          </button>
        ))}
      </div>

      <section className="settings-section">
        <div id="skills-source-panel" role="tabpanel">
          {visibleSkills.length === 0 ? (
            <p className="settings-empty-hint">
              在 <code>{skillLayoutRoot(activeLayout)}/&lt;skill-name&gt;/SKILL.md</code> 添加 Skill。
            </p>
          ) : (
            <ul className="skill-list">
              {visibleSkills.map((skill) => (
                <li key={skill.skillFilePath} className="skill-card">
                  <div className="skill-card-icon" aria-hidden>
                    <Sparkles size={16} />
                  </div>
                  <div className="skill-card-body">
                    <div className="skill-card-title-row">
                      <strong>{skill.name}</strong>
                      <button
                        type="button"
                        className="skill-card-uninstall"
                        aria-label={`卸载 ${skill.name}`}
                        title={isSystemCodexSkill(skill) ? "Codex 内置 Skill 不可卸载" : "卸载 Skill"}
                        disabled={isSystemCodexSkill(skill)}
                        onClick={() => {
                          setUninstallError(undefined);
                          setPendingUninstall(skill);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <p className="skill-card-description">{skill.description}</p>
                    <code className="skill-card-path" title={skill.skillFilePath}>
                      {skill.skillFilePath}
                    </code>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {pendingUninstall ? (
        <SkillUninstallConfirmDialog
          skill={pendingUninstall}
          busy={uninstalling}
          {...(uninstallError && { error: uninstallError })}
          onDismiss={() => {
            if (!uninstalling) {
              setPendingUninstall(undefined);
              setUninstallError(undefined);
            }
          }}
          onConfirm={() => {
            setUninstalling(true);
            setUninstallError(undefined);
            void onUninstall(pendingUninstall)
              .then(() => setPendingUninstall(undefined))
              .catch((error: unknown) =>
                setUninstallError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setUninstalling(false));
          }}
        />
      ) : null}
    </>
  );
}

function isSystemCodexSkill(skill: SkillInfo): boolean {
  return skill.layout === "codex" && /[/\\]\.codex[/\\]skills[/\\]\.system[/\\]/.test(skill.directory);
}

function skillLayoutRoot(layout: SkillLayout): string {
  if (layout === "codex") {
    return "~/.codex/skills";
  }
  if (layout === "claude") {
    return "~/.claude/skills";
  }
  return "~/.agents/skills";
}

function skillLayoutLabel(layout: SkillLayout): string {
  if (layout === "claude") return "Claude Code";
  if (layout === "codex") return "Codex";
  return "Agents";
}

function formatInstallCount(count: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: count >= 10_000 ? "compact" : "standard" }).format(count);
}

export function isCatalogSkillInstalled(skills: SkillInfo[], entry: SkillCatalogEntry): boolean {
  return skills.some(
    (skill) => skill.catalogSource === entry.source && skill.catalogSkillId === entry.skillId,
  );
}
