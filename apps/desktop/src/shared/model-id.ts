const ECO_SDK_ALIAS_PATTERN = /^eco-[a-z]+-[a-f0-9]{12}$/;

export function isEcoSdkModelAlias(modelId: string): boolean {
  return ECO_SDK_ALIAS_PATTERN.test(modelId.trim());
}

/** Prefer configured upstream id when live usage reports an SDK alias. */
export function pickDisplayModelId(
  live: string | undefined,
  configured: string | undefined,
): string | undefined {
  const liveTrimmed = live?.trim();
  const configuredTrimmed = configured?.trim();
  if (!liveTrimmed) {
    return configuredTrimmed || undefined;
  }
  if (isEcoSdkModelAlias(liveTrimmed)) {
    return configuredTrimmed || undefined;
  }
  return liveTrimmed;
}
