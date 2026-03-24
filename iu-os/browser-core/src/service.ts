import http from "node:http";
import { URL } from "node:url";
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Locator,
  Page,
  Request,
  Response,
} from "playwright-core";
import { chromium } from "playwright-core";
import { createBrowserCoreConfig, type BrowserCoreConfig } from "./config";
import { BrowserRefCache } from "./ref-cache";
import {
  buildRoleSnapshotFromAiSnapshot,
  buildRoleSnapshotFromAriaSnapshot,
  getRoleSnapshotStats,
  type RoleRefMap,
} from "./role-snapshot";
import type {
  BrowserActRequest,
  BrowserActionResult,
  BrowserConsoleMessage,
  BrowserNetworkRequest,
  BrowserPageError,
  BrowserProfile,
  BrowserProfileName,
  BrowserSnapshotElement,
  BrowserSnapshotResponse,
  BrowserStatusResponse,
  BrowserTab,
} from "./types";

const VERBOSE_BROWSER_CORE_LOGS = process.env.IU_VERBOSE_BROWSER_LOGS === "1";

const managedChrome = require("../../ManagedChrome.js") as {
  ensureManagedChrome: (url?: string, extraArgs?: string[], meta?: Record<string, unknown>) => Promise<unknown>;
  focusManagedChromeInstance: () => Promise<unknown>;
};

type ProfileConnection = {
  browser: Browser;
  context: BrowserContext;
  profile: BrowserProfile;
};

type PageObservation = {
  console: BrowserConsoleMessage[];
  errors: BrowserPageError[];
  requests: BrowserNetworkRequest[];
  requestIds: WeakMap<Request, string>;
  nextRequestId: number;
};

type StartOptions = Partial<BrowserCoreConfig>;
type WithSnapshotForAI = {
  _snapshotForAI?: (options?: { timeout?: number; track?: string }) => Promise<{ full?: string }>;
};

const pageTargetIds = new WeakMap<Page, string>();
const pageObservations = new WeakMap<Page, PageObservation>();

function isRestrictedUrl(url = "") {
  const normalized = String(url || "").toLowerCase();
  return (
    normalized.startsWith("chrome://") ||
    normalized.startsWith("chrome-extension://") ||
    normalized.startsWith("devtools://") ||
    normalized.startsWith("edge://") ||
    normalized.startsWith("about:")
  );
}

function clampTimeout(value: number | undefined, fallback: number) {
  const timeout = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(250, Math.min(120_000, timeout));
}

function toAIFriendlyError(error: unknown, selector: string): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("strict mode violation")) {
    const countMatch = message.match(/resolved to (\d+) elements/);
    const count = countMatch ? countMatch[1] : "multiple";
    return new Error(
      `Selector "${selector}" matched ${count} elements. Run a new snapshot and use an updated ref.`,
    );
  }

  if (
    (message.includes("Timeout") || message.includes("waiting for")) &&
    (message.includes("to be visible") || message.includes("not visible"))
  ) {
    return new Error(
      `Element "${selector}" is not visible right now. Run snapshot again to refresh current refs.`,
    );
  }

  if (
    message.includes("intercepts pointer events") ||
    message.includes("not receive pointer events") ||
    message.includes("not visible")
  ) {
    return new Error(
      `Element "${selector}" is not interactable (hidden or covered). Try scroll, close overlays, then re-snapshot.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function normalizeUrlForMatch(url = "") {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return raw.replace(/\/+$/, "").toLowerCase();
  }
}

function urlsMatch(left = "", right = "") {
  const a = normalizeUrlForMatch(left);
  const b = normalizeUrlForMatch(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

async function readJson(req: http.IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function writeJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function toTargetKey(profile: BrowserProfileName, targetId: string) {
  return `${profile}:${targetId}`;
}

function debugBrowserCore(message: string, details?: Record<string, unknown>) {
  if (!VERBOSE_BROWSER_CORE_LOGS) {
    return;
  }
  if (details) {
    console.log(`🧭 [BrowserCore] ${message}`, details);
    return;
  }
  console.log(`🧭 [BrowserCore] ${message}`);
}

export class BrowserCoreService {
  readonly config: BrowserCoreConfig;
  private server: http.Server | null = null;
  private readonly connections = new Map<BrowserProfileName, Promise<ProfileConnection>>();
  private readonly refs = new BrowserRefCache();
  private readonly lastTargetByProfile = new Map<BrowserProfileName, string>();

  constructor(config: BrowserCoreConfig) {
    this.config = config;
  }

  async start() {
    if (this.server) {
      return this;
    }
    this.server = http.createServer(async (req, res) => {
      try {
        if (!this.isAuthorized(req)) {
          return writeJson(res, 401, { ok: false, error: "Unauthorized browser request." });
        }
        const requestUrl = new URL(req.url || "/", `http://127.0.0.1:${this.config.servicePort}`);
        const method = req.method || "GET";
        await this.route(method, requestUrl, req, res);
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.listen(this.config.servicePort, "127.0.0.1", () => resolve());
      this.server?.once("error", reject);
    });
    return this;
  }

  async stop() {
    for (const pending of this.connections.values()) {
      const connection = await pending.catch(() => null);
      await connection?.browser.close().catch(() => undefined);
    }
    this.connections.clear();
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = null;
  }

  private isAuthorized(req: http.IncomingMessage) {
    const token = req.headers["x-iu-browser-token"];
    return typeof token === "string" && token === this.config.authToken;
  }

  private resolveProfile(name?: string): BrowserProfile {
    const profileName = (name?.trim() as BrowserProfileName) || this.config.defaultProfile;
    const profile = this.config.profiles[profileName];
    if (!profile) {
      throw new Error(`Unknown browser profile "${name}".`);
    }
    return profile;
  }

  private async ensureConnection(profile: BrowserProfile): Promise<ProfileConnection> {
    const existing = this.connections.get(profile.name);
    if (existing) {
      return await existing;
    }
    const pending = (async () => {
      if (profile.name === "managed") {
        await managedChrome.ensureManagedChrome("", [], { source: "browser-core" });
      }
      const browser = await chromium.connectOverCDP(profile.cdpUrl);
      const context = browser.contexts()[0];
      if (!context) {
        await browser.close().catch(() => undefined);
        throw new Error(`No browser context available for profile "${profile.name}".`);
      }
      browser.on("disconnected", () => {
        this.connections.delete(profile.name);
      });
      context.on("page", (page) => {
        void this.observePage(page);
      });
      await Promise.all(context.pages().map(async (page) => await this.observePage(page)));
      return { browser, context, profile };
    })();
    this.connections.set(profile.name, pending);
    try {
      return await pending;
    } catch (error) {
      this.connections.delete(profile.name);
      throw error;
    }
  }

  private async observePage(page: Page) {
    if (pageObservations.has(page)) {
      return;
    }
    const state: PageObservation = {
      console: [],
      errors: [],
      requests: [],
      requestIds: new WeakMap(),
      nextRequestId: 0,
    };
    pageObservations.set(page, state);
    const targetId = await this.resolveTargetId(page).catch(() => "");
    if (targetId) {
      pageTargetIds.set(page, targetId);
    }
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        // Renderer swaps and same-tab navigations can invalidate the previous target id.
        pageTargetIds.delete(page);
      }
    });
    page.on("console", (message: ConsoleMessage) => {
      state.console.push({
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
        location: message.location(),
      });
      if (state.console.length > 500) {
        state.console.shift();
      }
    });
    page.on("pageerror", (error: Error) => {
      state.errors.push({
        message: error.message,
        name: error.name,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      if (state.errors.length > 200) {
        state.errors.shift();
      }
    });
    page.on("request", (request: Request) => {
      state.nextRequestId += 1;
      const id = `r${state.nextRequestId}`;
      state.requestIds.set(request, id);
      state.requests.push({
        id,
        timestamp: new Date().toISOString(),
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      });
      if (state.requests.length > 500) {
        state.requests.shift();
      }
    });
    page.on("response", (response: Response) => {
      const request = response.request();
      const id = state.requestIds.get(request);
      const item = state.requests.find((entry) => entry.id === id);
      if (!item) return;
      item.status = response.status();
      item.ok = response.ok();
    });
    page.on("requestfailed", (request: Request) => {
      const id = state.requestIds.get(request);
      const item = state.requests.find((entry) => entry.id === id);
      if (!item) return;
      item.failureText = request.failure()?.errorText;
      item.ok = false;
    });
    page.on("close", () => {
      pageObservations.delete(page);
      pageTargetIds.delete(page);
    });
  }

  private async resolveTargetId(page: Page, options: { refresh?: boolean } = {}) {
    if (options.refresh) {
      pageTargetIds.delete(page);
    }
    const cached = pageTargetIds.get(page);
    if (cached) {
      return cached;
    }
    const session = await page.context().newCDPSession(page);
    const result = (await session.send("Target.getTargetInfo")) as { targetInfo?: { targetId?: string } };
    const targetId = result?.targetInfo?.targetId || "";
    if (!targetId) {
      throw new Error("Unable to resolve browser target id.");
    }
    pageTargetIds.set(page, targetId);
    return targetId;
  }

  private async listTabs(profileName?: string) {
    const profile = this.resolveProfile(profileName);
    const { context } = await this.ensureConnection(profile);
    const tabs = await Promise.all(
      context.pages().map(async (page) => {
        await this.observePage(page);
        const visibility = await page
          .evaluate(() => ({
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
          }))
          .catch(() => ({ visibilityState: "unknown", hasFocus: false }));
        const targetId = await this.resolveTargetId(page, { refresh: true }).catch(() => "");
        const title = await page.title().catch(() => "");
        return {
          targetId,
          url: page.url(),
          title,
          active: Boolean(visibility.hasFocus || visibility.visibilityState === "visible"),
        } satisfies BrowserTab;
      }),
    );
    return { profile, tabs };
  }

  private rememberTarget(profileName: BrowserProfileName, targetId: string) {
    const normalized = String(targetId || "").trim();
    if (!normalized) return;
    this.lastTargetByProfile.set(profileName, normalized);
  }

  private getRememberedTarget(profileName: BrowserProfileName) {
    return this.lastTargetByProfile.get(profileName) || "";
  }

  private async pickPage(profileName?: string, targetId?: string, allowRestricted = false) {
    const profile = this.resolveProfile(profileName);
    const { context } = await this.ensureConnection(profile);
    const pages = context.pages();
    for (const page of pages) {
      await this.observePage(page);
    }
    const requestedTargetId = String(targetId || "").trim() || this.getRememberedTarget(profile.name);
    if (requestedTargetId) {
      for (const page of pages) {
        const pageTargetId = await this.resolveTargetId(page, { refresh: true }).catch(() => "");
        if (pageTargetId === requestedTargetId) {
          this.rememberTarget(profile.name, pageTargetId);
          return { profile, page };
        }
      }
      if (targetId) {
        throw new Error(`Browser tab "${requestedTargetId}" not found.`);
      }
    }
    for (const page of pages) {
      const state = await page
        .evaluate(() => ({ visibilityState: document.visibilityState, hasFocus: document.hasFocus() }))
        .catch(() => ({ visibilityState: "unknown", hasFocus: false }));
      if (state.hasFocus || state.visibilityState === "visible") {
        const pageTargetId = await this.resolveTargetId(page, { refresh: true }).catch(() => "");
        this.rememberTarget(profile.name, pageTargetId);
        return { profile, page };
      }
    }
    const preferred = pages.find((page) => {
      const url = page.url();
      return allowRestricted || !isRestrictedUrl(url);
    });
    if (preferred) {
      const pageTargetId = await this.resolveTargetId(preferred, { refresh: true }).catch(() => "");
      this.rememberTarget(profile.name, pageTargetId);
      return { profile, page: preferred };
    }
    if (pages[0]) {
      const pageTargetId = await this.resolveTargetId(pages[0], { refresh: true }).catch(() => "");
      this.rememberTarget(profile.name, pageTargetId);
      return { profile, page: pages[0] };
    }
    throw new Error(`No browser tabs available for profile "${profile.name}".`);
  }

  private async getViewportOffset(page: Page) {
    return await page
      .evaluate(() => ({
        x: window.screenX + (window.outerWidth - window.innerWidth) / 2,
        y: window.screenY + (window.outerHeight - window.innerHeight),
      }))
      .catch(() => ({ x: 0, y: 0 }));
  }

  private async getViewportSize(page: Page) {
    return await page
      .evaluate(() => ({
        width: Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
        height: Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
      }))
      .catch(() => ({ width: 0, height: 0 }));
  }

  private locatorForStoredRef(page: Page, entry: BrowserSnapshotElement): Locator {
    if (entry.locatorStrategy === "aria") {
      return page.locator(`aria-ref=${entry.ref}`);
    }
    if (entry.locatorStrategy === "role") {
      const pageByRole = page as unknown as {
        getByRole: (
          role: never,
          opts?: { name?: string; exact?: boolean },
        ) => ReturnType<Page["getByRole"]>;
      };
      const locator = entry.name
        ? pageByRole.getByRole(entry.role as never, { name: entry.name, exact: true })
        : pageByRole.getByRole(entry.role as never);
      return typeof entry.nth === "number" ? locator.nth(entry.nth) : locator;
    }
    if (entry.selector?.trim()) {
      return page.locator(entry.selector.trim());
    }
    throw new Error(`Unknown or expired browser ref "${entry.ref}". Run snapshot again.`);
  }

  private async buildSnapshotElements(params: {
    page: Page;
    profile: BrowserProfileName;
    targetId: string;
    refs: RoleRefMap;
    locatorStrategy: "role" | "aria";
  }) {
    const viewportOffset = await this.getViewportOffset(params.page);
    const viewportSize = await this.getViewportSize(params.page);
    const elements: BrowserSnapshotElement[] = [];
    for (const [ref, refInfo] of Object.entries(params.refs)) {
      const element: BrowserSnapshotElement = {
        ref,
        key: `${refInfo.role}:${refInfo.name ?? ""}:${refInfo.nth ?? 0}`,
        role: refInfo.role,
        label: refInfo.name || refInfo.role,
        ...(refInfo.name ? { name: refInfo.name } : {}),
        ...(typeof refInfo.nth === "number" ? { nth: refInfo.nth } : {}),
        locatorStrategy: params.locatorStrategy,
      };
      try {
        const locator = this.locatorForStoredRef(params.page, element);
        const metadata = await locator
          .evaluate((node) => {
            if (!(node instanceof HTMLElement)) {
              return null;
            }
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const pointerEvents = String(style.pointerEvents || "").toLowerCase();
            const opacity = Number(style.opacity || "1");
            const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
            const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const clampedX = Math.min(Math.max(centerX, 0), Math.max(0, viewportWidth - 1));
            const clampedY = Math.min(Math.max(centerY, 0), Math.max(0, viewportHeight - 1));
            const topAtCenter = document.elementFromPoint(clampedX, clampedY);
            const receivesPointer =
              !!topAtCenter &&
              (topAtCenter === node ||
                node.contains(topAtCenter) ||
                (topAtCenter instanceof HTMLElement && topAtCenter.contains(node)));
            const inViewport =
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom >= 0 &&
              rect.right >= 0 &&
              rect.top <= viewportHeight &&
              rect.left <= viewportWidth;
            const visible =
              inViewport &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              opacity !== 0 &&
              pointerEvents !== "none" &&
              node.getAttribute("aria-hidden") !== "true";
            return {
              tag: node.tagName.toLowerCase(),
              text: String(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
              visible,
              receivesPointer,
              rect: {
                x: rect.x,
                y: rect.y,
                w: rect.width,
                h: rect.height,
              },
            };
          })
          .catch(() => null);
        const box = await locator.boundingBox().catch(() => null);
        const tag = metadata?.tag;
        const text = metadata?.text;
        if (tag) {
          element.tag = tag;
        }
        if (text) {
          element.text = text;
        }
        const rect = metadata?.rect;
        const actionable =
          metadata?.visible === true &&
          metadata?.receivesPointer === true &&
          !!rect &&
          rect.w > 0 &&
          rect.h > 0 &&
          rect.x + rect.w >= 0 &&
          rect.y + rect.h >= 0 &&
          rect.x <= viewportSize.width &&
          rect.y <= viewportSize.height;
        if (!actionable) {
          continue;
        }
        if (box) {
          element.bbox = {
            x: viewportOffset.x + box.x,
            y: viewportOffset.y + box.y,
            w: box.width,
            h: box.height,
          };
          element.center = {
            x: viewportOffset.x + box.x + box.width / 2,
            y: viewportOffset.y + box.y + box.height / 2,
          };
        }
      } catch {
        // Best-effort metadata only; semantic ref remains valid without bbox.
      }
      elements.push(element);
    }
    return this.refs.store(params.profile, params.targetId, elements);
  }

  private async buildSemanticSnapshot(page: Page, format: "ai" | "aria") {
    if (format === "ai") {
      const maybe = page as unknown as WithSnapshotForAI;
      if (typeof maybe._snapshotForAI === "function") {
        const captured = await maybe
          ._snapshotForAI({
            timeout: 5_000,
            track: "response",
          })
          .catch(() => null);
        const full = String(captured?.full || "").trim();
        if (full) {
          const built = buildRoleSnapshotFromAiSnapshot(full, {
            interactive: true,
            compact: true,
          });
          if (Object.keys(built.refs).length > 0) {
            return {
              snapshot: built.snapshot,
              refs: built.refs,
              locatorStrategy: "aria" as const,
            };
          }
        }
      }
    }

    const ariaSnapshot = await page.locator(":root").ariaSnapshot();
    const interactive = buildRoleSnapshotFromAriaSnapshot(String(ariaSnapshot || ""), {
      interactive: true,
      compact: true,
    });
    if (format === "aria") {
      const expanded = buildRoleSnapshotFromAriaSnapshot(String(ariaSnapshot || ""), {
        compact: false,
      });
      return {
        snapshot: expanded.snapshot,
        refs: interactive.refs,
        locatorStrategy: "role" as const,
      };
    }
    return {
      snapshot: interactive.snapshot,
      refs: interactive.refs,
      locatorStrategy: "role" as const,
    };
  }

  private async snapshot(profileName?: string, targetId?: string, format: "ai" | "aria" = "ai", maxChars?: number) {
    const { profile, page } = await this.pickPage(profileName, targetId);
    const resolvedTargetId = await this.resolveTargetId(page, { refresh: true });
    const semantic = await this.buildSemanticSnapshot(page, format);
    const elements = await this.buildSnapshotElements({
      page,
      profile: profile.name,
      targetId: resolvedTargetId,
      refs: semantic.refs,
      locatorStrategy: semantic.locatorStrategy,
    });
    let snapshot = semantic.snapshot;
    let truncated = false;
    const limit = typeof maxChars === "number" && Number.isFinite(maxChars) ? Math.floor(maxChars) : 12_000;
    if (snapshot.length > limit) {
      snapshot = `${snapshot.slice(0, limit)}\n\n[...TRUNCATED]`;
      truncated = true;
    }
    const refs = Object.fromEntries(
      elements.map((element) => {
        const { ref, ...rest } = element;
        return [ref, rest];
      }),
    );
    const response: BrowserSnapshotResponse = {
      ok: true,
      profile: profile.name,
      format,
      targetId: resolvedTargetId,
      url: page.url(),
      snapshot,
      refs,
      stats: getRoleSnapshotStats(snapshot, semantic.refs),
      ...(truncated ? { truncated } : {}),
      elements,
    };
    return response;
  }

  private async captureTabIds(context: BrowserContext) {
    const ids = new Set<string>();
    for (const page of context.pages()) {
      await this.observePage(page);
      const targetId = await this.resolveTargetId(page, { refresh: true }).catch(() => "");
      if (targetId) {
        ids.add(targetId);
      }
    }
    return ids;
  }

  private async settleAfterAction(page: Page, timeoutMs: number) {
    const settleTimeout = Math.max(250, Math.min(1_500, Math.floor(timeoutMs / 4)));
    await Promise.race([
      page.waitForLoadState("domcontentloaded", { timeout: settleTimeout }).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, settleTimeout)),
    ]);
  }

  private async resolvePostActionPage(params: {
    profile: BrowserProfile;
    page: Page;
    previousTargetId: string;
    previousUrl: string;
    previousTabIds: Set<string>;
    popupPage?: Page | null;
    timeoutMs: number;
    kind: BrowserActRequest["kind"];
  }) {
    const { profile, page, previousTargetId, previousUrl, previousTabIds, timeoutMs, kind } = params;
    const context = page.context();
    const popupPage = params.popupPage ?? null;

    if (popupPage) {
      await this.observePage(popupPage);
      await this.settleAfterAction(popupPage, timeoutMs);
      const popupTargetId = await this.resolveTargetId(popupPage, { refresh: true }).catch(() => "");
      if (popupTargetId) {
        debugBrowserCore(`action "${kind}" opened a new tab`, {
          previousTargetId,
          nextTargetId: popupTargetId,
          previousUrl,
          nextUrl: popupPage.url(),
        });
        return {
          page: popupPage,
          targetId: popupTargetId,
          url: popupPage.url(),
        };
      }
    }

    await this.settleAfterAction(page, timeoutMs);

    for (const candidate of context.pages()) {
      await this.observePage(candidate);
      const candidateTargetId = await this.resolveTargetId(candidate, { refresh: true }).catch(() => "");
      if (candidateTargetId && !previousTabIds.has(candidateTargetId)) {
        debugBrowserCore(`action "${kind}" switched to a discovered tab`, {
          previousTargetId,
          nextTargetId: candidateTargetId,
          previousUrl,
          nextUrl: candidate.url(),
        });
        return {
          page: candidate,
          targetId: candidateTargetId,
          url: candidate.url(),
        };
      }
    }

    const refreshedTargetId = await this.resolveTargetId(page, { refresh: true }).catch(() => previousTargetId);
    const refreshedUrl = page.url();
    if (refreshedTargetId !== previousTargetId || refreshedUrl !== previousUrl) {
      debugBrowserCore(`action "${kind}" updated the active tab`, {
        previousTargetId,
        nextTargetId: refreshedTargetId,
        previousUrl,
        nextUrl: refreshedUrl,
      });
    }

    return {
      page,
      targetId: refreshedTargetId || previousTargetId,
      url: refreshedUrl || previousUrl,
    };
  }

  private resolveLocator(page: Page, profile: BrowserProfileName, targetId: string, ref?: string, selector?: string) {
    if (selector?.trim()) {
      return page.locator(selector.trim());
    }
    const rawRef = String(ref || "").trim();
    const normalizedRef = rawRef.startsWith("ref=")
      ? rawRef.slice(4)
      : rawRef.startsWith("@")
        ? rawRef.slice(1)
        : rawRef;
    if (!normalizedRef) {
      throw new Error("Action requires ref or selector.");
    }
    const entry = this.refs.resolve(profile, targetId, normalizedRef);
    if (!entry) {
      throw new Error(`Unknown or expired browser ref "${normalizedRef}". Run snapshot again.`);
    }
    return this.locatorForStoredRef(page, entry);
  }

  private async act(profileName: string | undefined, request: BrowserActRequest): Promise<BrowserActionResult> {
    const { profile, page } = await this.pickPage(profileName, request.targetId);
    const targetId = await this.resolveTargetId(page, { refresh: true });
    const previousUrl = page.url();
    let previousTabIds = await this.captureTabIds(page.context());
    const timeout = "timeoutMs" in request ? clampTimeout(request.timeoutMs, 8_000) : 8_000;
    debugBrowserCore(`act "${request.kind}" start`, {
      profile: profile.name,
      targetId,
      url: previousUrl,
      hasRef: "ref" in request ? Boolean(request.ref) : false,
      hasSelector: "selector" in request ? Boolean(request.selector) : false,
    });

    let resolvedPage = page;
    let resolvedTargetId = targetId;
    let resolvedUrl = previousUrl;

    const runSingleAction = async (step: BrowserActRequest, stepTimeout: number) => {
      const selectorHint =
        "ref" in step && step.ref
          ? `ref=${step.ref}`
          : "selector" in step && step.selector
            ? String(step.selector)
            : step.kind;
      try {
        switch (step.kind) {
          case "click": {
            const locator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.ref,
              step.selector,
            );
            const popupPromise = resolvedPage
              .context()
              .waitForEvent("page", { timeout: Math.max(250, Math.min(stepTimeout, 750)) })
              .catch(() => null);
            const clickOpts: {
              timeout: number;
              button?: "left" | "right" | "middle";
              modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
              delay?: number;
            } = { timeout: stepTimeout };
            if (step.button) clickOpts.button = step.button;
            if (Array.isArray(step.modifiers) && step.modifiers.length > 0) clickOpts.modifiers = step.modifiers;
            if (typeof step.delayMs === "number" && Number.isFinite(step.delayMs) && step.delayMs > 0) {
              clickOpts.delay = Math.floor(step.delayMs);
            }
            if (step.doubleClick) {
              await locator.dblclick(clickOpts);
            } else {
              await locator.click(clickOpts);
            }
            const popupPage = await popupPromise;
            const reconciled = await this.resolvePostActionPage({
              profile,
              page: resolvedPage,
              previousTargetId: resolvedTargetId,
              previousUrl: resolvedUrl,
              previousTabIds,
              popupPage,
              timeoutMs: stepTimeout,
              kind: step.kind,
            });
            resolvedPage = reconciled.page;
            resolvedTargetId = reconciled.targetId;
            resolvedUrl = reconciled.url;
            previousTabIds = await this.captureTabIds(resolvedPage.context());
            break;
          }
          case "hover": {
            const locator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.ref,
              step.selector,
            );
            await locator.hover({ timeout: stepTimeout });
            break;
          }
          case "scrollIntoView": {
            const locator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.ref,
              step.selector,
            );
            await locator.scrollIntoViewIfNeeded({ timeout: stepTimeout });
            break;
          }
          case "type": {
            const locator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.ref,
              step.selector,
            );
            if (step.slowly) {
              await locator.click({ timeout: stepTimeout });
              await locator.type(step.text, { timeout: stepTimeout, delay: 75 });
            } else {
              await locator.fill(step.text, { timeout: stepTimeout });
            }
            if (step.submit) {
              await locator.press("Enter", { timeout: stepTimeout });
            }
            break;
          }
          case "fill": {
            for (const field of step.fields) {
              const locator = this.resolveLocator(
                resolvedPage,
                profile.name,
                resolvedTargetId,
                field.ref,
                field.selector,
              );
              if (field.type === "checkbox" || field.type === "radio") {
                const checked = field.value === true || field.value === "true" || field.value === 1;
                await locator.setChecked(checked, { timeout: stepTimeout });
              } else {
                await locator.fill(String(field.value), { timeout: stepTimeout });
              }
            }
            break;
          }
          case "press": {
            await resolvedPage.keyboard.press(step.key, {
              delay: Math.max(0, Math.floor(step.delayMs ?? 0)),
            });
            break;
          }
          case "drag": {
            const startLocator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.startRef,
              step.startSelector,
            );
            const endLocator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.endRef,
              step.endSelector,
            );
            await startLocator.dragTo(endLocator, { timeout: stepTimeout });
            break;
          }
          case "select": {
            const locator = this.resolveLocator(
              resolvedPage,
              profile.name,
              resolvedTargetId,
              step.ref,
              step.selector,
            );
            await locator.selectOption(step.value as string | string[], { timeout: stepTimeout });
            break;
          }
          case "wait": {
            if (step.timeMs && step.timeMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, step.timeMs));
            }
            if (step.loadState) {
              await resolvedPage.waitForLoadState(step.loadState, { timeout: stepTimeout });
            }
            if (step.selector) {
              await resolvedPage.waitForSelector(step.selector, { timeout: stepTimeout, state: "visible" });
            }
            if (step.text) {
              await resolvedPage.waitForFunction(
                (value) => document.body?.innerText?.includes(value),
                step.text,
                { timeout: stepTimeout },
              );
            }
            if (step.url) {
              await resolvedPage.waitForFunction(
                (value) => window.location.href.includes(value),
                step.url,
                { timeout: stepTimeout },
              );
            }
            resolvedTargetId = await this.resolveTargetId(resolvedPage, { refresh: true }).catch(
              () => resolvedTargetId,
            );
            resolvedUrl = resolvedPage.url();
            break;
          }
          case "evaluate": {
            await resolvedPage.evaluate(step.expression as unknown as never);
            resolvedTargetId = await this.resolveTargetId(resolvedPage, { refresh: true }).catch(
              () => resolvedTargetId,
            );
            resolvedUrl = resolvedPage.url();
            break;
          }
          case "batch":
            throw new Error('Nested "batch" actions are not supported.');
          default:
            throw new Error(`Unsupported browser action "${String((step as { kind: string }).kind)}".`);
        }
      } catch (error) {
        throw toAIFriendlyError(error, selectorHint);
      }
    };

    const batchDetails: {
      executed?: number;
      total?: number;
      stopOnError?: boolean;
      errors?: Array<{ index: number; kind: string; error: string }>;
    } = {};

    if (request.kind === "batch") {
      const actions = Array.isArray(request.actions) ? request.actions : [];
      const errors: Array<{ index: number; kind: string; error: string }> = [];
      let executed = 0;
      const stopOnError = request.stopOnError !== false;
      for (let index = 0; index < actions.length; index += 1) {
        const step = actions[index];
        if (!step) continue;
        const normalizedStep: BrowserActRequest = {
          ...step,
          ...(step.targetId ? {} : { targetId: request.targetId || resolvedTargetId }),
        } as BrowserActRequest;
        const stepTimeout = "timeoutMs" in step ? clampTimeout(step.timeoutMs, timeout) : timeout;
        try {
          await runSingleAction(normalizedStep, stepTimeout);
          executed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ index, kind: step.kind, error: message });
          if (stopOnError) {
            break;
          }
        }
      }
      batchDetails.executed = executed;
      batchDetails.total = actions.length;
      batchDetails.stopOnError = stopOnError;
      if (errors.length > 0) {
        batchDetails.errors = errors;
      }
    } else {
      await runSingleAction(request, timeout);
    }

    if (resolvedPage !== page) {
      await resolvedPage.bringToFront().catch(() => undefined);
      if (profile.name === "managed") {
        await managedChrome.focusManagedChromeInstance().catch(() => undefined);
      }
    }

    this.rememberTarget(profile.name, resolvedTargetId);
    debugBrowserCore(`act "${request.kind}" done`, {
      profile: profile.name,
      previousTargetId: targetId,
      targetId: resolvedTargetId,
      previousUrl,
      url: resolvedUrl,
    });
    return {
      ok: true,
      profile: profile.name,
      targetId: resolvedTargetId,
      url: resolvedUrl,
      details:
        request.kind === "batch"
          ? {
              kind: request.kind,
              executed: batchDetails.executed ?? 0,
              total: batchDetails.total ?? 0,
              stopOnError: batchDetails.stopOnError ?? true,
              errors: batchDetails.errors ?? [],
            }
          : { kind: request.kind },
    };
  }

  private async route(
    method: string,
    requestUrl: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    if (method === "GET" && requestUrl.pathname === "/v1/status") {
      const payload: BrowserStatusResponse = {
        ok: true,
        enabled: this.config.enabled,
        defaultProfile: this.config.defaultProfile,
        servicePort: this.config.servicePort,
        profiles: Object.values(this.config.profiles),
      };
      return writeJson(res, 200, payload);
    }
    if (method === "GET" && requestUrl.pathname === "/v1/profiles") {
      return writeJson(res, 200, { ok: true, profiles: Object.values(this.config.profiles) });
    }
    if (method === "GET" && requestUrl.pathname === "/v1/tabs") {
      const result = await this.listTabs(requestUrl.searchParams.get("profile") || undefined);
      return writeJson(res, 200, { ok: true, profile: result.profile.name, tabs: result.tabs });
    }
    if (method === "POST" && requestUrl.pathname === "/v1/open") {
      const body = (await readJson(req)) as { profile?: string; url?: string };
      if (!body.url) {
        return writeJson(res, 400, { ok: false, error: "Browser open requires url." });
      }
      const profile = this.resolveProfile(body.profile);
      const { context } = await this.ensureConnection(profile);
      const existingPages = context.pages();
      const page =
        existingPages.find((candidate) => urlsMatch(candidate.url(), body.url || "")) ||
        existingPages.find((candidate) => {
          const currentUrl = candidate.url();
          return !currentUrl || currentUrl === "about:blank" || currentUrl.startsWith("chrome://newtab");
        }) ||
        (await context.newPage());
      await this.observePage(page);
      if (!urlsMatch(page.url(), body.url)) {
        await page.goto(body.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      }
      await page.bringToFront().catch(() => undefined);
      if (profile.name === "managed") {
        await managedChrome.focusManagedChromeInstance().catch(() => undefined);
      }
      const openedTargetId = await this.resolveTargetId(page);
      this.rememberTarget(profile.name, openedTargetId);
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: openedTargetId,
        url: page.url(),
      });
    }
    if (method === "POST" && requestUrl.pathname === "/v1/focus") {
      const body = (await readJson(req)) as { profile?: string; targetId?: string };
      const { profile, page } = await this.pickPage(body.profile, body.targetId);
      await page.bringToFront().catch(() => undefined);
      if (profile.name === "managed") {
        await managedChrome.focusManagedChromeInstance().catch(() => undefined);
      }
      const focusedTargetId = await this.resolveTargetId(page);
      this.rememberTarget(profile.name, focusedTargetId);
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: focusedTargetId,
        url: page.url(),
      });
    }
    if (method === "POST" && requestUrl.pathname === "/v1/close") {
      const body = (await readJson(req)) as { profile?: string; targetId?: string };
      const { profile, page } = await this.pickPage(body.profile, body.targetId, true);
      const targetId = await this.resolveTargetId(page);
      const url = page.url();
      await page.close();
      this.lastTargetByProfile.delete(profile.name);
      return writeJson(res, 200, { ok: true, profile: profile.name, targetId, url });
    }
    if (method === "POST" && requestUrl.pathname === "/v1/navigate") {
      const body = (await readJson(req)) as { profile?: string; targetId?: string; url?: string; timeoutMs?: number };
      if (!body.url) {
        return writeJson(res, 400, { ok: false, error: "Browser navigate requires url." });
      }
      const { profile, page } = await this.pickPage(body.profile, body.targetId);
      await page.goto(body.url, {
        waitUntil: "domcontentloaded",
        timeout: clampTimeout(body.timeoutMs, 20_000),
      });
      const navigatedTargetId = await this.resolveTargetId(page);
      this.rememberTarget(profile.name, navigatedTargetId);
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: navigatedTargetId,
        url: page.url(),
      });
    }
    if (method === "GET" && requestUrl.pathname === "/v1/snapshot") {
      const payload = await this.snapshot(
        requestUrl.searchParams.get("profile") || undefined,
        requestUrl.searchParams.get("targetId") || undefined,
        requestUrl.searchParams.get("format") === "aria" ? "aria" : "ai",
        Number.parseInt(requestUrl.searchParams.get("maxChars") || "", 10) || undefined,
      );
      debugBrowserCore("snapshot served", {
        profile: payload.profile,
        targetId: payload.targetId,
        url: payload.url,
        refs: payload.stats.refs,
        chars: payload.stats.chars,
      });
      this.rememberTarget(payload.profile, payload.targetId);
      return writeJson(res, 200, payload);
    }
    if (method === "POST" && requestUrl.pathname === "/v1/act") {
      const body = (await readJson(req)) as BrowserActRequest & { profile?: string };
      if (!body.kind) {
        return writeJson(res, 400, { ok: false, error: "Browser act requires kind." });
      }
      const payload = await this.act(body.profile, body);
      return writeJson(res, 200, payload);
    }
    if (method === "POST" && requestUrl.pathname === "/v1/screenshot") {
      const body = (await readJson(req)) as {
        profile?: string;
        targetId?: string;
        ref?: string;
        selector?: string;
        fullPage?: boolean;
        type?: "png" | "jpeg";
      };
      const { profile, page } = await this.pickPage(body.profile, body.targetId);
      const type = body.type === "jpeg" ? "jpeg" : "png";
      let buffer: Buffer;
      if (body.ref || body.selector) {
        const targetId = await this.resolveTargetId(page);
        const locator = this.resolveLocator(page, profile.name, targetId, body.ref, body.selector);
        buffer = await locator.screenshot({ type, timeout: 15_000 });
      } else {
        buffer = await page.screenshot({ type, fullPage: body.fullPage === true });
      }
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: await this.resolveTargetId(page),
        url: page.url(),
        type,
        data: buffer.toString("base64"),
      });
    }
    if (method === "GET" && requestUrl.pathname === "/v1/console") {
      const { profile, page } = await this.pickPage(
        requestUrl.searchParams.get("profile") || undefined,
        requestUrl.searchParams.get("targetId") || undefined,
      );
      const targetId = await this.resolveTargetId(page);
      this.rememberTarget(profile.name, targetId);
      const state = pageObservations.get(page);
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId,
        messages: state?.console ?? [],
        errors: state?.errors ?? [],
      });
    }
    if (method === "GET" && requestUrl.pathname === "/v1/network") {
      const { profile, page } = await this.pickPage(
        requestUrl.searchParams.get("profile") || undefined,
        requestUrl.searchParams.get("targetId") || undefined,
      );
      const targetId = await this.resolveTargetId(page);
      this.rememberTarget(profile.name, targetId);
      const state = pageObservations.get(page);
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId,
        requests: state?.requests ?? [],
      });
    }
    return writeJson(res, 404, { ok: false, error: `Unknown browser route: ${requestUrl.pathname}` });
  }
}

export async function startBrowserCoreService(overrides: StartOptions = {}) {
  const config = createBrowserCoreConfig(overrides);
  const service = new BrowserCoreService(config);
  await service.start();
  return service;
}
