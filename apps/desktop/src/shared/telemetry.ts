import {
  defaultEcoTelemetrySettings,
  type EcoTelemetrySettings,
} from "@eco/runtime";

export type { EcoTelemetrySettings };

export interface TelemetrySettingsSnapshot extends EcoTelemetrySettings {}

export interface TelemetrySettingsInput extends EcoTelemetrySettings {}

export function emptyTelemetrySettings(): TelemetrySettingsSnapshot {
  return defaultEcoTelemetrySettings();
}

export function normalizeTelemetrySettings(input: TelemetrySettingsInput): TelemetrySettingsSnapshot {
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const serviceName = input.serviceName.trim() || "eco-coding";
  const headers = input.headers?.trim();

  return {
    enabled: Boolean(input.enabled),
    endpoint: endpoint || "http://localhost:4318",
    ...(headers ? { headers } : {}),
    serviceName,
    traces: input.traces !== false,
    metrics: input.metrics !== false,
    logs: input.logs !== false,
    exportIntervalMs: Math.max(500, Number(input.exportIntervalMs) || 1000),
  };
}

export function validateTelemetrySettings(input: TelemetrySettingsInput): void {
  if (!input.enabled) {
    return;
  }
  const endpoint = input.endpoint.trim();
  if (!endpoint) {
    throw new Error("启用监测时需要填写 OTLP Endpoint。");
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("OTLP Endpoint 须为 http 或 https URL。");
    }
  } catch {
    throw new Error("OTLP Endpoint 格式无效。");
  }
}
