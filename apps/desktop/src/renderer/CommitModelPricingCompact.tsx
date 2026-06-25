import { formatRatePerMillion } from "@eco/runtime";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { CommitModelPricingHint, RoutePricingHint } from "../shared/ipc";

interface CommitModelPricingCompactProps {
  hint?: RoutePricingHint | CommitModelPricingHint | undefined;
}

function formatCompactRate(usd: number): string {
  const formatted = formatRatePerMillion(usd);
  return formatted.startsWith("$") ? formatted.slice(1) : formatted;
}

export function CommitModelPricingCompact({ hint }: CommitModelPricingCompactProps) {
  const rates = hint?.rates;

  if (!rates || rates.inputPerM <= 0 || rates.outputPerM <= 0) {
    if (hint && !hint.pricingResolved) {
      return (
        <span className="git-commit-model-pricing-unknown" title="定价未知">
          —
        </span>
      );
    }
    return null;
  }

  return (
    <span className="git-commit-model-pricing-compact" title={hint?.pricingLabel}>
      <span className="git-commit-model-price git-commit-model-price-in" title="输入 /M">
        <ArrowUp size={11} strokeWidth={2.25} aria-hidden />
        <span>{formatCompactRate(rates.inputPerM)}</span>
      </span>
      <span className="git-commit-model-price git-commit-model-price-out" title="输出 /M">
        <ArrowDown size={11} strokeWidth={2.25} aria-hidden />
        <span>{formatCompactRate(rates.outputPerM)}</span>
      </span>
    </span>
  );
}

export function CommitModelProviderDot({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      className="git-commit-model-provider-dot"
      style={{ backgroundColor: color }}
      aria-hidden
      title={label}
    />
  );
}
