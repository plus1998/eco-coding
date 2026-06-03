import {
  API_COMPAT_THEME,
  normalizeUpstreamApiCompat,
  toggleUpstreamApiCompat,
  UPSTREAM_API_COMPAT_OPTIONS,
  type UpstreamApiCompat,
} from "../shared/api-compat";

interface ApiCompatToggleProps {
  /** Runtime may still carry legacy `openai`; normalized before render. */
  value: UpstreamApiCompat | string | undefined;
  onChange: (value: UpstreamApiCompat) => void;
  disabled?: boolean | undefined;
}

function apiCompatDisplayLabel(value: UpstreamApiCompat | string | undefined): string {
  const normalized = normalizeUpstreamApiCompat(value);
  return (
    UPSTREAM_API_COMPAT_OPTIONS.find((option) => option.value === normalized)?.label ??
    API_COMPAT_THEME[normalized].label
  );
}

export function ApiCompatToggle({ value, onChange, disabled }: ApiCompatToggleProps) {
  const normalizedValue = normalizeUpstreamApiCompat(value);
  const nextValue = toggleUpstreamApiCompat(normalizedValue);
  const currentLabel = apiCompatDisplayLabel(normalizedValue);
  const nextLabel = apiCompatDisplayLabel(nextValue);
  const tooltip = `当前是 ${currentLabel}，点击切换为 ${nextLabel}`;

  return (
    <button
      type="button"
      className={`api-compat-toggle api-compat-toggle--${normalizedValue.replace(/_/g, "-")}`}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
      onClick={() => onChange(nextValue)}
    >
      <span className="api-compat-toggle-dot" aria-hidden />
    </button>
  );
}
