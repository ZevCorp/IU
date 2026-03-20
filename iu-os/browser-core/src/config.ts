import { randomBytes } from "node:crypto";
import type { BrowserCapabilities, BrowserCoreClientOptions, BrowserProfile, BrowserProfileName } from "./types";

export const DEFAULT_BROWSER_SERVICE_PORT = 42315;
export const DEFAULT_MANAGED_CDP_URL = "http://127.0.0.1:9222";
export const DEFAULT_USER_CDP_URL = "http://127.0.0.1:9224";

export type BrowserCoreConfig = {
  enabled: boolean;
  servicePort: number;
  authToken: string;
  defaultProfile: BrowserProfileName;
  profiles: Record<BrowserProfileName, BrowserProfile>;
};

function capabilities(overrides: Partial<BrowserCapabilities> = {}): BrowserCapabilities {
  return {
    canLaunch: false,
    canSnapshot: true,
    canAct: true,
    canObserve: true,
    requiresExistingSession: false,
    ...overrides,
  };
}

export function createBrowserCoreConfig(overrides: Partial<BrowserCoreConfig> = {}): BrowserCoreConfig {
  const managed: BrowserProfile = {
    name: "managed",
    mode: "managed",
    driver: "managed-cdp",
    cdpUrl: overrides.profiles?.managed?.cdpUrl ?? process.env.IU_MANAGED_BROWSER_CDP_URL ?? DEFAULT_MANAGED_CDP_URL,
    capabilities: capabilities({ canLaunch: true }),
  };
  const user: BrowserProfile = {
    name: "user",
    mode: "user",
    driver: "user-existing-session",
    cdpUrl: overrides.profiles?.user?.cdpUrl ?? process.env.IU_USER_BROWSER_CDP_URL ?? DEFAULT_USER_CDP_URL,
    capabilities: capabilities({ requiresExistingSession: true }),
  };
  return {
    enabled: overrides.enabled ?? true,
    servicePort:
      overrides.servicePort ??
      (Number.parseInt(process.env.IU_BROWSER_SERVICE_PORT || "", 10) || DEFAULT_BROWSER_SERVICE_PORT),
    authToken: overrides.authToken ?? process.env.IU_BROWSER_AUTH_TOKEN ?? randomBytes(24).toString("hex"),
    defaultProfile: overrides.defaultProfile ?? "managed",
    profiles: {
      managed: { ...managed, ...overrides.profiles?.managed },
      user: { ...user, ...overrides.profiles?.user },
    },
  };
}

export function toClientOptions(config: BrowserCoreConfig): BrowserCoreClientOptions {
  return {
    baseUrl: `http://127.0.0.1:${config.servicePort}`,
    authToken: config.authToken,
  };
}
