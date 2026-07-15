import { formatRatePerMillion } from "@eco/runtime/models-dev-pricing";
import type { RoutePricingRates } from "../shared/ipc";

interface RoutePricingDisplayProps {
  rates: RoutePricingRates;
  title?: string;
}

export function RoutePricingDisplay({ rates, title }: RoutePricingDisplayProps) {
  const hasCache = rates.cacheReadPerM !== undefined || rates.cacheWritePerM !== undefined;

  return (
    <div className="models-route-pricing" title={title}>
      <div className="models-route-pricing-row">
        <span className="models-route-pricing-chip models-route-pricing-chip-in">
          <span className="models-route-pricing-key" aria-hidden>
            ↑
          </span>
          <span className="models-route-pricing-val">{formatRatePerMillion(rates.inputPerM)}/M</span>
        </span>
        <span className="models-route-pricing-chip models-route-pricing-chip-out">
          <span className="models-route-pricing-key" aria-hidden>
            ↓
          </span>
          <span className="models-route-pricing-val">{formatRatePerMillion(rates.outputPerM)}/M</span>
        </span>
      </div>
      {hasCache ? (
        <div className="models-route-pricing-row models-route-pricing-row-cache">
          {rates.cacheReadPerM !== undefined ? (
            <span className="models-route-pricing-chip models-route-pricing-chip-cache">
              <span className="models-route-pricing-key" aria-hidden>
                ⊙读
              </span>
              <span className="models-route-pricing-val">
                {formatRatePerMillion(rates.cacheReadPerM)}/M
              </span>
            </span>
          ) : null}
          {rates.cacheWritePerM !== undefined ? (
            <span className="models-route-pricing-chip models-route-pricing-chip-cache">
              <span className="models-route-pricing-key" aria-hidden>
                ⊙写
              </span>
              <span className="models-route-pricing-val">
                {formatRatePerMillion(rates.cacheWritePerM)}/M
              </span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
