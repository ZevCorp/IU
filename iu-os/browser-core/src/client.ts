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
  BrowserSnapshotRequest,
  BrowserSnapshotResponse,
  BrowserStatusResponse,
  BrowserTab,
  BrowserTabTargetRequest,
} from "./types";

type QueryValue = string | number | boolean | undefined;

function appendQuery(path: string, query: Record<string, QueryValue> = {}) {
  const url = new URL(path, "http://127.0.0.1");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

export class BrowserCoreClient {
  constructor(private readonly options: BrowserCoreClientOptions) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-iu-browser-token": this.options.authToken,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.ok === false) {
      const error = typeof payload.error === "string" ? payload.error : `Browser request failed: ${response.status}`;
      throw new Error(error);
    }
    return payload as T;
  }

  async status(): Promise<BrowserStatusResponse> {
    return await this.request<BrowserStatusResponse>("GET", "/v1/status");
  }

  async profiles(): Promise<{ ok: true; profiles: BrowserProfile[] }> {
    return await this.request<{ ok: true; profiles: BrowserProfile[] }>("GET", "/v1/profiles");
  }

  async tabs(profile?: BrowserProfileName): Promise<{ ok: true; profile: BrowserProfileName; tabs: BrowserTab[] }> {
    return await this.request("GET", appendQuery("/v1/tabs", { profile }));
  }

  async open(request: BrowserOpenRequest): Promise<BrowserActionResult> {
    return await this.request("POST", "/v1/open", request);
  }

  async focus(request: BrowserTabTargetRequest & { profile?: BrowserProfileName }): Promise<BrowserActionResult> {
    return await this.request("POST", "/v1/focus", request);
  }

  async close(request: BrowserTabTargetRequest & { profile?: BrowserProfileName }): Promise<BrowserActionResult> {
    return await this.request("POST", "/v1/close", request);
  }

  async navigate(request: BrowserNavigateRequest): Promise<BrowserActionResult> {
    return await this.request("POST", "/v1/navigate", request);
  }

  async snapshot(request: BrowserSnapshotRequest = {}): Promise<BrowserSnapshotResponse> {
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

  async act(
    profile: BrowserProfileName | undefined,
    request: BrowserActRequest,
  ): Promise<BrowserActionResult> {
    return await this.request("POST", "/v1/act", { profile, ...request });
  }

  async screenshot(request: BrowserScreenshotRequest): Promise<BrowserScreenshotResponse> {
    return await this.request("POST", "/v1/screenshot", request);
  }

  async console(
    profile?: BrowserProfileName,
    targetId?: string,
  ): Promise<{ ok: true; profile: BrowserProfileName; targetId: string; messages: unknown[] }> {
    return await this.request("GET", appendQuery("/v1/console", { profile, targetId }));
  }

  async network(
    profile?: BrowserProfileName,
    targetId?: string,
  ): Promise<{ ok: true; profile: BrowserProfileName; targetId: string; requests: unknown[] }> {
    return await this.request("GET", appendQuery("/v1/network", { profile, targetId }));
  }
}

export function createBrowserCoreClient(options: BrowserCoreClientOptions) {
  return new BrowserCoreClient(options);
}
