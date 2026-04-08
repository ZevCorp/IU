import { readFile } from "node:fs/promises";
import type {
  BrowserActRequest,
  BrowserActionResult,
  BrowserCoreClientOptions,
  BrowserNavigateRequest,
  BrowserOpenRequest,
  BrowserProfile,
  BrowserProfileName,
  BrowserScreenshotRequest,
  BrowserScreenshotResponse,
  BrowserSnapshotElement,
  BrowserSnapshotRequest,
  BrowserSnapshotResponse,
  BrowserStatusResponse,
  BrowserTab,
  BrowserTabTargetRequest,
} from "./types";

type QueryValue = string | number | boolean | undefined;

type OpenClawProfileStatus = {
  name?: string;
  driver?: "openclaw" | "existing-session";
  cdpUrl?: string | null;
};

type OpenClawAiSnapshot = {
  ok?: true;
  format: "ai";
  targetId: string;
  url: string;
  snapshot?: string;
  truncated?: boolean;
  refs?: Record<string, { role: string; name?: string; nth?: number }>;
  stats?: {
    lines: number;
    chars: number;
    refs: number;
    interactive: number;
  };
};

type OpenClawAriaSnapshot = {
  ok?: true;
  format: "aria";
  targetId: string;
  url: string;
  nodes?: Array<{
    ref: string;
    role: string;
    name: string;
    value?: string;
    description?: string;
    depth?: number;
  }>;
};

type OpenClawSnapshot = OpenClawAiSnapshot | OpenClawAriaSnapshot;

type OpenClawActResponse = {
  ok?: true;
  targetId: string;
  url?: string;
  result?: unknown;
  results?: Array<{ ok: boolean; error?: string }>;
};

type OpenClawScreenshotResponse = {
  ok?: true;
  path?: string;
  targetId: string;
  url: string;
};

function appendQuery(path: string, query: Record<string, QueryValue> = {}) {
  const url = new URL(path, "http://127.0.0.1");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function computeSnapshotStats(snapshot: string, refsCount: number) {
  const lines = snapshot ? snapshot.split("\n").length : 0;
  return {
    lines,
    chars: snapshot.length,
    refs: refsCount,
    interactive: refsCount,
  };
}

export class BrowserCoreClient {
  constructor(private readonly options: BrowserCoreClientOptions) {}

  private isOpenClawBackend() {
    return this.options.backend === "openclaw";
  }

  private normalizeProfileName(profileName?: string): BrowserProfileName {
    const normalized = String(profileName || "").trim().toLowerCase();
    return normalized === "user" ? "user" : "managed";
  }

  private resolveOpenClawProfile(profile?: string) {
    const aliases = this.options.profileAliases || {};
    const requested = String(profile || "").trim();
    if (requested === "managed") {
      return aliases.managed || this.options.defaultProfile || "openclaw";
    }
    if (requested === "user") {
      return aliases.user || "user";
    }
    return requested || this.options.defaultProfile || aliases.managed || "openclaw";
  }

  private buildHeaders(includeJsonBody = false) {
    const headers = new Headers();
    if (includeJsonBody) {
      headers.set("content-type", "application/json");
    }
    if (this.isOpenClawBackend()) {
      if (this.options.authToken) {
        headers.set("Authorization", `Bearer ${this.options.authToken}`);
      } else if (this.options.password) {
        headers.set("x-openclaw-password", this.options.password);
      }
      return headers;
    }
    if (this.options.authToken) {
      headers.set("x-iu-browser-token", this.options.authToken);
    }
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok === false) {
      const error = typeof payload.error === "string" ? payload.error : `Browser request failed: ${response.status}`;
      throw new Error(error);
    }
    return payload as T;
  }

  private async openClawRequest<T>(
    method: string,
    path: string,
    options: {
      query?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const fullPath = appendQuery(path, options.query || {});
    const response = await fetch(`${this.options.baseUrl}${fullPath}`, {
      method,
      headers: this.buildHeaders(options.body !== undefined),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
      : null;
    if (!response.ok || (payload && payload.ok === false)) {
      const error =
        (payload && typeof payload.error === "string" && payload.error) ||
        (await response.text().catch(() => "")) ||
        `OpenClaw browser request failed: ${response.status}`;
      throw new Error(error);
    }
    return ((payload || {}) as unknown) as T;
  }

  private mapOpenClawProfile(profileName: BrowserProfileName, remote?: OpenClawProfileStatus): BrowserProfile {
    const actualName = this.resolveOpenClawProfile(profileName);
    const actualDriver = remote?.driver || (profileName === "user" ? "existing-session" : "openclaw");
    const usesExistingSession = actualDriver === "existing-session";
    return {
      name: profileName,
      mode: profileName,
      driver: usesExistingSession ? "user-existing-session" : "managed-cdp",
      cdpUrl: remote?.cdpUrl || this.options.baseUrl,
      capabilities: {
        canLaunch: !usesExistingSession,
        canSnapshot: true,
        canAct: true,
        canObserve: true,
        requiresExistingSession: usesExistingSession,
      },
    };
  }

  private mapOpenClawSnapshot(snapshot: OpenClawSnapshot, profile?: string): BrowserSnapshotResponse {
    const normalizedProfile = this.normalizeProfileName(profile);
    if (snapshot.format === "ai") {
      const refs = snapshot.refs || {};
      const elements: BrowserSnapshotElement[] = Object.entries(refs).map(([ref, info]) => ({
        ref,
        key: `${info.role}:${info.name ?? ""}:${info.nth ?? 0}`,
        role: info.role,
        label: info.name || info.role,
        ...(info.name ? { name: info.name } : {}),
        ...(typeof info.nth === "number" ? { nth: info.nth } : {}),
      }));
      return {
        ok: true,
        profile: normalizedProfile,
        format: "ai",
        targetId: snapshot.targetId,
        url: snapshot.url,
        snapshot: snapshot.snapshot || "",
        refs: Object.fromEntries(
          elements.map((element) => {
            const { ref, ...rest } = element;
            return [ref, rest];
          }),
        ),
        stats: snapshot.stats || computeSnapshotStats(snapshot.snapshot || "", elements.length),
        ...(snapshot.truncated ? { truncated: true } : {}),
        elements,
      };
    }

    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    const snapshotText = nodes
      .map((node) => `${"  ".repeat(Math.max(0, Number(node.depth) || 0))}${node.ref} ${node.role} ${node.name || ""}`.trimEnd())
      .join("\n");
    const elements: BrowserSnapshotElement[] = nodes.map((node) => ({
      ref: node.ref,
      key: `${node.role}:${node.name || ""}:0`,
      role: node.role,
      label: node.name || node.role,
      ...(node.name ? { name: node.name } : {}),
    }));
    return {
      ok: true,
      profile: normalizedProfile,
      format: "aria",
      targetId: snapshot.targetId,
      url: snapshot.url,
      snapshot: snapshotText,
      refs: Object.fromEntries(
        elements.map((element) => {
          const { ref, ...rest } = element;
          return [ref, rest];
        }),
      ),
      stats: computeSnapshotStats(snapshotText, elements.length),
      elements,
    };
  }

  private mapOpenClawActionRequest(request: BrowserActRequest): Record<string, unknown> {
    if (request.kind === "select") {
      return {
        ...request,
        values: Array.isArray(request.value) ? request.value : [String(request.value)],
      };
    }
    if (request.kind === "evaluate") {
      return {
        kind: "evaluate",
        targetId: request.targetId,
        fn: request.expression,
        timeoutMs: request.timeoutMs,
      };
    }
    if (request.kind === "batch") {
      return {
        kind: "batch",
        targetId: request.targetId,
        stopOnError: request.stopOnError,
        actions: request.actions.map((action) => this.mapOpenClawActionRequest(action as BrowserActRequest)),
      };
    }
    return { ...request };
  }

  async status(): Promise<BrowserStatusResponse> {
    if (!this.isOpenClawBackend()) {
      return await this.request<BrowserStatusResponse>("GET", "/v1/status");
    }
    const openclawProfile = this.resolveOpenClawProfile("managed");
    let payload: {
      enabled?: boolean;
      profile?: string;
    } = {};
    let statusResolved = false;
    for (const path of ["/", "/status"]) {
      try {
        payload = await this.openClawRequest<{
          enabled?: boolean;
          profile?: string;
        }>("GET", path, {
          query: { profile: openclawProfile },
        });
        statusResolved = true;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/not found/i.test(message)) {
          throw error;
        }
      }
    }
    const profiles = (await this.profiles()).profiles;
    let servicePort = 0;
    try {
      servicePort = Number.parseInt(new URL(this.options.baseUrl).port || "", 10) || 0;
    } catch {
      servicePort = 0;
    }
    return {
      ok: true,
      enabled: statusResolved ? payload.enabled !== false : true,
      defaultProfile: "managed",
      servicePort,
      profiles,
    };
  }

  async profiles(): Promise<{ ok: true; profiles: BrowserProfile[] }> {
    if (!this.isOpenClawBackend()) {
      return await this.request<{ ok: true; profiles: BrowserProfile[] }>("GET", "/v1/profiles");
    }
    const payload = await this.openClawRequest<{ profiles?: OpenClawProfileStatus[] }>("GET", "/profiles");
    const remoteProfiles = Array.isArray(payload.profiles) ? payload.profiles : [];
    const managedRemote =
      remoteProfiles.find((profile) => profile.name === this.resolveOpenClawProfile("managed")) ||
      remoteProfiles.find((profile) => profile.driver !== "existing-session");
    const userRemote =
      remoteProfiles.find((profile) => profile.name === this.resolveOpenClawProfile("user")) ||
      remoteProfiles.find((profile) => profile.driver === "existing-session");

    const profiles = [this.mapOpenClawProfile("managed", managedRemote)];
    if (userRemote || this.resolveOpenClawProfile("user")) {
      profiles.push(this.mapOpenClawProfile("user", userRemote));
    }
    return { ok: true, profiles };
  }

  async tabs(profile?: BrowserProfileName): Promise<{ ok: true; profile: BrowserProfileName; tabs: BrowserTab[] }> {
    if (!this.isOpenClawBackend()) {
      return await this.request("GET", appendQuery("/v1/tabs", { profile }));
    }
    const normalizedProfile = this.normalizeProfileName(profile);
    const payload = await this.openClawRequest<{ tabs?: BrowserTab[] }>("GET", "/tabs", {
      query: { profile: this.resolveOpenClawProfile(profile) },
    });
    return {
      ok: true,
      profile: normalizedProfile,
      tabs: Array.isArray(payload.tabs) ? payload.tabs : [],
    };
  }

  async open(request: BrowserOpenRequest): Promise<BrowserActionResult> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/open", request);
    }
    const payload = await this.openClawRequest<BrowserTab>("POST", "/tabs/open", {
      query: { profile: this.resolveOpenClawProfile(request.profile) },
      body: { url: request.url },
    });
    return {
      ok: true,
      profile: this.normalizeProfileName(request.profile),
      targetId: payload.targetId,
      url: payload.url,
    };
  }

  async focus(request: BrowserTabTargetRequest & { profile?: BrowserProfileName }): Promise<BrowserActionResult> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/focus", request);
    }
    await this.openClawRequest("POST", "/tabs/focus", {
      query: { profile: this.resolveOpenClawProfile(request.profile) },
      body: { targetId: request.targetId },
    });
    const tabs = await this.tabs(request.profile);
    const tab = tabs.tabs.find((entry) => entry.targetId === request.targetId);
    return {
      ok: true,
      profile: tabs.profile,
      targetId: request.targetId,
      url: tab?.url || "",
    };
  }

  async close(request: BrowserTabTargetRequest & { profile?: BrowserProfileName }): Promise<BrowserActionResult> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/close", request);
    }
    const tabs = await this.tabs(request.profile);
    const tab = tabs.tabs.find((entry) => entry.targetId === request.targetId);
    await this.openClawRequest("DELETE", `/tabs/${encodeURIComponent(request.targetId)}`, {
      query: { profile: this.resolveOpenClawProfile(request.profile) },
    });
    return {
      ok: true,
      profile: tabs.profile,
      targetId: request.targetId,
      url: tab?.url || "",
    };
  }

  async navigate(request: BrowserNavigateRequest): Promise<BrowserActionResult> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/navigate", request);
    }
    const payload = await this.openClawRequest<{ targetId: string; url: string }>("POST", "/navigate", {
      query: { profile: this.resolveOpenClawProfile(request.profile) },
      body: {
        url: request.url,
        targetId: request.targetId,
      },
    });
    return {
      ok: true,
      profile: this.normalizeProfileName(request.profile),
      targetId: payload.targetId,
      url: payload.url,
    };
  }

  async snapshot(request: BrowserSnapshotRequest = {}): Promise<BrowserSnapshotResponse> {
    if (!this.isOpenClawBackend()) {
      return await this.request(
        "GET",
        appendQuery("/v1/snapshot", {
          profile: request.profile,
          targetId: request.targetId,
          format: request.format,
          maxChars: request.maxChars,
        }),
      );
    }
    const payload = await this.openClawRequest<OpenClawSnapshot>("GET", "/snapshot", {
      query: {
        profile: this.resolveOpenClawProfile(request.profile),
        targetId: request.targetId,
        format: request.format,
        maxChars: request.maxChars,
      },
    });
    return this.mapOpenClawSnapshot(payload, request.profile);
  }

  async act(
    profile: BrowserProfileName | undefined,
    request: BrowserActRequest,
  ): Promise<BrowserActionResult> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/act", { profile, ...request });
    }
    const payload = await this.openClawRequest<OpenClawActResponse>("POST", "/act", {
      query: { profile: this.resolveOpenClawProfile(profile) },
      body: this.mapOpenClawActionRequest(request),
    });
    return {
      ok: true,
      profile: this.normalizeProfileName(profile),
      targetId: payload.targetId,
      url: payload.url || "",
      ...(payload.result !== undefined ? { details: { kind: request.kind, result: payload.result } } : {}),
    };
  }

  async screenshot(request: BrowserScreenshotRequest): Promise<BrowserScreenshotResponse> {
    if (!this.isOpenClawBackend()) {
      return await this.request("POST", "/v1/screenshot", request);
    }
    const payload = await this.openClawRequest<OpenClawScreenshotResponse>("POST", "/screenshot", {
      query: { profile: this.resolveOpenClawProfile(request.profile) },
      body: {
        targetId: request.targetId,
        fullPage: request.fullPage,
        ref: request.ref,
        element: request.selector,
        type: request.type,
      },
    });
    if (!payload.path) {
      throw new Error("OpenClaw screenshot did not return a file path.");
    }
    const data = await readFile(payload.path);
    return {
      ok: true,
      profile: this.normalizeProfileName(request.profile),
      targetId: payload.targetId,
      url: payload.url,
      type: request.type === "jpeg" ? "jpeg" : "png",
      data: data.toString("base64"),
    };
  }

  async console(
    profile?: BrowserProfileName,
    targetId?: string,
  ): Promise<{ ok: true; profile: BrowserProfileName; targetId: string; messages: unknown[] }> {
    if (!this.isOpenClawBackend()) {
      return await this.request("GET", appendQuery("/v1/console", { profile, targetId }));
    }
    const payload = await this.openClawRequest<{ messages?: unknown[]; targetId: string }>("GET", "/console", {
      query: { profile: this.resolveOpenClawProfile(profile), targetId },
    });
    return {
      ok: true,
      profile: this.normalizeProfileName(profile),
      targetId: payload.targetId,
      messages: Array.isArray(payload.messages) ? payload.messages : [],
    };
  }

  async network(
    profile?: BrowserProfileName,
    targetId?: string,
  ): Promise<{ ok: true; profile: BrowserProfileName; targetId: string; requests: unknown[] }> {
    if (!this.isOpenClawBackend()) {
      return await this.request("GET", appendQuery("/v1/network", { profile, targetId }));
    }
    const payload = await this.openClawRequest<{ requests?: unknown[]; targetId: string }>("GET", "/requests", {
      query: { profile: this.resolveOpenClawProfile(profile), targetId },
    });
    return {
      ok: true,
      profile: this.normalizeProfileName(profile),
      targetId: payload.targetId,
      requests: Array.isArray(payload.requests) ? payload.requests : [],
    };
  }
}

export function createBrowserCoreClient(options: BrowserCoreClientOptions) {
  return new BrowserCoreClient(options);
}
