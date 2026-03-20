import http from "node:http";
import { URL } from "node:url";
import type {
  Browser,
  BrowserContext,
  ConsoleMessage,
  Page,
  Request,
  Response,
} from "playwright-core";
import { chromium } from "playwright-core";
import { createBrowserCoreConfig, type BrowserCoreConfig } from "./config";
import { BrowserRefCache } from "./ref-cache";
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

export class BrowserCoreService {
  readonly config: BrowserCoreConfig;
  private server: http.Server | null = null;
  private readonly connections = new Map<BrowserProfileName, Promise<ProfileConnection>>();
  private readonly refs = new BrowserRefCache();

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

  private async resolveTargetId(page: Page) {
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
        const targetId = await this.resolveTargetId(page).catch(() => "");
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

  private async pickPage(profileName?: string, targetId?: string, allowRestricted = false) {
    const profile = this.resolveProfile(profileName);
    const { context } = await this.ensureConnection(profile);
    const pages = context.pages();
    for (const page of pages) {
      await this.observePage(page);
    }
    if (targetId) {
      for (const page of pages) {
        const pageTargetId = await this.resolveTargetId(page).catch(() => "");
        if (pageTargetId === targetId) {
          return { profile, page };
        }
      }
      throw new Error(`Browser tab "${targetId}" not found.`);
    }
    for (const page of pages) {
      const state = await page
        .evaluate(() => ({ visibilityState: document.visibilityState, hasFocus: document.hasFocus() }))
        .catch(() => ({ visibilityState: "unknown", hasFocus: false }));
      if (state.hasFocus || state.visibilityState === "visible") {
        return { profile, page };
      }
    }
    const preferred = pages.find((page) => {
      const url = page.url();
      return allowRestricted || !isRestrictedUrl(url);
    });
    if (preferred) {
      return { profile, page: preferred };
    }
    if (pages[0]) {
      return { profile, page: pages[0] };
    }
    throw new Error(`No browser tabs available for profile "${profile.name}".`);
  }

  private async extractElements(page: Page, limit = 250) {
    const raw = await page.evaluate((maxElements) => {
      const roleLike = ["button", "link", "textbox", "searchbox", "combobox", "menuitem", "checkbox", "radio", "tab"];
      const selector = [
        "a[href]",
        "button",
        "input:not([type=\"hidden\"])",
        "select",
        "textarea",
        "[role]",
        "[contenteditable=\"true\"]",
        "[tabindex]",
      ].join(",");
      const absoluteOX = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const absoluteOY = window.screenY + (window.outerHeight - window.innerHeight);
      const candidates = Array.from(document.querySelectorAll(selector));

      function isVisible(el: HTMLElement, rect: DOMRect) {
        const style = window.getComputedStyle(el);
        const pointerEvents = String(style.pointerEvents || "").toLowerCase();
        if (pointerEvents === "none") return false;
        const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        const centerX = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(0, viewportWidth - 1));
        const centerY = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(0, viewportHeight - 1));
        const topAtCenter = document.elementFromPoint(centerX, centerY);
        const receivesPointer =
          !!topAtCenter &&
          (topAtCenter === el ||
            el.contains(topAtCenter) ||
            (topAtCenter instanceof HTMLElement && topAtCenter.contains(el)));
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom >= 0 &&
          rect.right >= 0 &&
          rect.top <= viewportHeight &&
          rect.left <= viewportWidth &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || "1") !== 0 &&
          el.getAttribute("aria-hidden") !== "true" &&
          receivesPointer
        );
      }

      function labelFor(el: HTMLElement) {
        const aria = el.getAttribute("aria-label") || "";
        const labelledBy = el.getAttribute("aria-labelledby");
        const byId = labelledBy ? document.getElementById(labelledBy)?.innerText || "" : "";
        const text = el.innerText || el.textContent || "";
        const inputValue =
          (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
            ? el.value
            : "") ||
          el.getAttribute("value") ||
          el.getAttribute("placeholder") ||
          "";
        return String(aria || byId || inputValue || text || el.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
      }

      function roleFor(el: HTMLElement) {
        const explicit = (el.getAttribute("role") || "").trim().toLowerCase();
        if (explicit) return explicit;
        const tag = el.tagName.toLowerCase();
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          if (["checkbox"].includes(type)) return "checkbox";
          if (["radio"].includes(type)) return "radio";
          return "textbox";
        }
        if (el.isContentEditable) return "textbox";
        return tag;
      }

      function uniqueSelectorFor(el: HTMLElement) {
        if (el.id) return `#${el.id}`;
        const parts = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 4) {
          const tag = current.tagName.toLowerCase();
          const parent = current.parentElement;
          if (!parent) break;
          const siblings = Array.from(parent.children).filter((candidate) => candidate.tagName === current.tagName);
          const index = siblings.indexOf(current);
          const nth = siblings.length > 1 ? `:nth-of-type(${index + 1})` : "";
          parts.unshift(`${tag}${nth}`);
          current = parent;
        }
        return parts.join(" > ");
      }

      const seen = new Set();
      const elements = [];
      for (const candidate of candidates as Element[]) {
        if (!(candidate instanceof HTMLElement)) continue;
        const rect = candidate.getBoundingClientRect();
        if (!isVisible(candidate, rect)) continue;
        const role = roleFor(candidate);
        const label = labelFor(candidate);
        const selectorText = uniqueSelectorFor(candidate);
        const interactive = roleLike.includes(role) || candidate.isContentEditable || candidate.tabIndex >= 0;
        if (!interactive) continue;
        if (!label && !["textbox", "combobox", "checkbox", "radio"].includes(role)) continue;
        const dedupe = `${role}|${label}|${selectorText}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        elements.push({
          key: selectorText || dedupe,
          role,
          label: label || role,
          selector: selectorText || undefined,
          tag: candidate.tagName.toLowerCase(),
          text: String(candidate.innerText || candidate.textContent || "").trim().slice(0, 120),
          bbox: { x: absoluteOX + rect.x, y: absoluteOY + rect.y, w: rect.width, h: rect.height },
          center: { x: absoluteOX + rect.x + rect.width / 2, y: absoluteOY + rect.y + rect.height / 2 },
        });
        if (elements.length >= maxElements) break;
      }
      return {
        title: document.title || "",
        url: window.location.href,
        elements,
      };
    }, limit);
    return raw as {
      title: string;
      url: string;
      elements: Array<Omit<BrowserSnapshotElement, "ref">>;
    };
  }

  private formatSnapshot(elements: BrowserSnapshotElement[]) {
    return elements
      .map((element) => `${element.ref} [${element.role}] ${element.label}${element.text ? ` :: ${element.text}` : ""}`)
      .join("\n");
  }

  private async snapshot(profileName?: string, targetId?: string, format: "ai" | "aria" = "ai", maxChars?: number) {
    const { profile, page } = await this.pickPage(profileName, targetId);
    const resolvedTargetId = await this.resolveTargetId(page);
    const extracted = await this.extractElements(page);
    const elements = this.refs.apply(profile.name, resolvedTargetId, extracted.elements);
    let snapshot = this.formatSnapshot(elements);
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
      url: extracted.url,
      snapshot,
      refs,
      stats: {
        lines: snapshot ? snapshot.split("\n").length : 0,
        chars: snapshot.length,
        refs: elements.length,
        interactive: elements.length,
      },
      ...(truncated ? { truncated } : {}),
      elements,
    };
    return response;
  }

  private resolveSelector(profile: BrowserProfileName, targetId: string, ref?: string, selector?: string) {
    if (selector?.trim()) {
      return selector.trim();
    }
    if (!ref?.trim()) {
      throw new Error("Action requires ref or selector.");
    }
    const entry = this.refs.resolve(profile, targetId, ref);
    if (!entry?.selector) {
      throw new Error(`Unknown or expired browser ref "${ref}". Run snapshot again.`);
    }
    return entry.selector;
  }

  private async act(profileName: string | undefined, request: BrowserActRequest): Promise<BrowserActionResult> {
    const { profile, page } = await this.pickPage(profileName, request.targetId);
    const targetId = await this.resolveTargetId(page);
    const timeout = "timeoutMs" in request ? clampTimeout(request.timeoutMs, 8_000) : 8_000;
    switch (request.kind) {
      case "click": {
        const selector = this.resolveSelector(profile.name, targetId, request.ref, request.selector);
        await page.locator(selector).click({ timeout });
        break;
      }
      case "hover": {
        const selector = this.resolveSelector(profile.name, targetId, request.ref, request.selector);
        await page.locator(selector).hover({ timeout });
        break;
      }
      case "scrollIntoView": {
        const selector = this.resolveSelector(profile.name, targetId, request.ref, request.selector);
        await page.locator(selector).scrollIntoViewIfNeeded({ timeout });
        break;
      }
      case "type": {
        const selector = this.resolveSelector(profile.name, targetId, request.ref, request.selector);
        const locator = page.locator(selector);
        if (request.slowly) {
          await locator.click({ timeout });
          await locator.type(request.text, { timeout, delay: 75 });
        } else {
          await locator.fill(request.text, { timeout });
        }
        if (request.submit) {
          await locator.press("Enter", { timeout });
        }
        break;
      }
      case "fill": {
        for (const field of request.fields) {
          const selector = this.resolveSelector(profile.name, targetId, field.ref, field.selector);
          const locator = page.locator(selector);
          if (field.type === "checkbox" || field.type === "radio") {
            const checked = field.value === true || field.value === "true" || field.value === 1;
            await locator.setChecked(checked, { timeout });
          } else {
            await locator.fill(String(field.value), { timeout });
          }
        }
        break;
      }
      case "press": {
        await page.keyboard.press(request.key, { delay: Math.max(0, Math.floor(request.delayMs ?? 0)) });
        break;
      }
      case "drag": {
        const startSelector = this.resolveSelector(profile.name, targetId, request.startRef, request.startSelector);
        const endSelector = this.resolveSelector(profile.name, targetId, request.endRef, request.endSelector);
        await page.locator(startSelector).dragTo(page.locator(endSelector), { timeout });
        break;
      }
      case "wait": {
        if (request.timeMs && request.timeMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, request.timeMs));
        }
        if (request.loadState) {
          await page.waitForLoadState(request.loadState, { timeout });
        }
        if (request.selector) {
          await page.waitForSelector(request.selector, { timeout, state: "visible" });
        }
        if (request.text) {
          await page.waitForFunction(
            (value) => document.body?.innerText?.includes(value),
            request.text,
            { timeout },
          );
        }
        if (request.url) {
          await page.waitForFunction(
            (value) => window.location.href.includes(value),
            request.url,
            { timeout },
          );
        }
        break;
      }
      default:
        throw new Error(`Unsupported browser action "${String((request as { kind: string }).kind)}".`);
    }
    return {
      ok: true,
      profile: profile.name,
      targetId,
      url: page.url(),
      details: { kind: request.kind },
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
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: await this.resolveTargetId(page),
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
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: await this.resolveTargetId(page),
        url: page.url(),
      });
    }
    if (method === "POST" && requestUrl.pathname === "/v1/close") {
      const body = (await readJson(req)) as { profile?: string; targetId?: string };
      const { profile, page } = await this.pickPage(body.profile, body.targetId, true);
      const targetId = await this.resolveTargetId(page);
      const url = page.url();
      await page.close();
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
      return writeJson(res, 200, {
        ok: true,
        profile: profile.name,
        targetId: await this.resolveTargetId(page),
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
        const selector = this.resolveSelector(profile.name, targetId, body.ref, body.selector);
        buffer = await page.locator(selector).screenshot({ type, timeout: 15_000 });
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
