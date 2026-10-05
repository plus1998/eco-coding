export interface OpenAIAccountProfile {
  email?: string;
  password?: string;
  pickupUrl?: string;
  twoFactorSecret?: string;
}

export interface OpenAIAccountCreateInput extends OpenAIAccountProfile {
  name: string;
  proxyUrl?: string;
}

export interface OpenAIAccountUpdateInput extends OpenAIAccountProfile {
  accountId: string;
  name: string;
  proxyUrl?: string;
}

export interface OpenAIAccount {
  id: string;
  name: string;
  email?: string;
  proxyUrl?: string;
  /** Whether this account has usable, non-expired Codex credentials. */
  isLoggedIn: boolean;
  authState: "missing" | "configured" | "expired";
  lastLogin?: string;
  createdAt: string;
  /** The list API exposes profile presence, not the profile secrets themselves. */
  hasProfileData: boolean;
  profileFields?: { email: boolean; password: boolean; pickupUrl: boolean; twoFactorSecret: boolean };
}

export interface OpenAIAccountAssistantState {
  accountId: string;
  name: string;
  email?: string;
  hasPassword: boolean;
  hasPickupUrl: boolean;
  pickupHost?: string;
  hasTwoFactorSecret: boolean;
  code?: string;
  remainingSeconds?: number;
  codeError?: string;
  canFill: boolean;
  hasLoginWindow: boolean;
  pinned: boolean;
}

export type OpenAIAccountAssistantAction =
  | { type: "copy" | "fill"; field: "email" | "password" | "code" }
  | { type: "openPickup" }
  | { type: "togglePin" }
  | { type: "revealPassword" };

export interface OpenAIAccountAssistantActionResult {
  message: string;
  value?: string;
}

export interface OpenAIAccountDetails extends OpenAIAccountProfile {
  id: string;
  name: string;
  proxyUrl?: string;
  createdAt: string;
  updatedAt: string;
  authJson: string | null;
}

export interface OpenAIAccountSyncStatus {
  state: "ok" | "error" | "conflict";
  message?: string;
  updatedAt?: string;
}

export interface OpenAIAccountImportResult {
  added: number;
  updated: number;
}
