export type BrowserProfileName = "managed" | "user";
export type BrowserProfileMode = "managed" | "user";
export type BrowserDriverName = "managed-cdp" | "user-existing-session";

export type BrowserCapabilities = {
  canLaunch: boolean;
  canSnapshot: boolean;
  canAct: boolean;
  canObserve: boolean;
  requiresExistingSession: boolean;
};

export type BrowserProfile = {
  name: BrowserProfileName;
  mode: BrowserProfileMode;
  driver: BrowserDriverName;
  cdpUrl: string;
  capabilities: BrowserCapabilities;
};

export type BrowserTab = {
  targetId: string;
  url: string;
  title: string;
  active: boolean;
};

export type BrowserBoundingBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type BrowserSnapshotElement = {
  ref: string;
  key: string;
  role: string;
  label: string;
  name?: string;
  nth?: number;
  locatorStrategy?: "role" | "aria" | "selector";
  selector?: string;
  bbox?: BrowserBoundingBox;
  center?: { x: number; y: number };
  tag?: string;
  text?: string;
};

export type BrowserSnapshotResponse = {
  ok: true;
  profile: BrowserProfileName;
  format: "ai" | "aria";
  targetId: string;
  url: string;
  snapshot: string;
  refs: Record<string, Omit<BrowserSnapshotElement, "ref">>;
  stats: {
    lines: number;
    chars: number;
    refs: number;
    interactive: number;
  };
  truncated?: boolean;
  labels?: boolean;
  elements?: BrowserSnapshotElement[];
};

export type BrowserFormField = {
  ref?: string;
  selector?: string;
  value: string | number | boolean;
  type?: "text" | "checkbox" | "radio";
};

export type BrowserClickAction = {
  kind: "click";
  targetId?: string;
  ref?: string;
  selector?: string;
  doubleClick?: boolean;
  button?: "left" | "right" | "middle";
  modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">;
  delayMs?: number;
  timeoutMs?: number;
};

export type BrowserHoverAction = {
  kind: "hover";
  targetId?: string;
  ref?: string;
  selector?: string;
  timeoutMs?: number;
};

export type BrowserScrollIntoViewAction = {
  kind: "scrollIntoView";
  targetId?: string;
  ref?: string;
  selector?: string;
  timeoutMs?: number;
};

export type BrowserTypeAction = {
  kind: "type";
  targetId?: string;
  ref?: string;
  selector?: string;
  text: string;
  slowly?: boolean;
  submit?: boolean;
  timeoutMs?: number;
};

export type BrowserFillAction = {
  kind: "fill";
  targetId?: string;
  fields: BrowserFormField[];
  timeoutMs?: number;
};

export type BrowserPressAction = {
  kind: "press";
  targetId?: string;
  key: string;
  delayMs?: number;
};

export type BrowserDragAction = {
  kind: "drag";
  targetId?: string;
  startRef?: string;
  startSelector?: string;
  endRef?: string;
  endSelector?: string;
  timeoutMs?: number;
};

export type BrowserSelectAction = {
  kind: "select";
  targetId?: string;
  ref?: string;
  selector?: string;
  value: string | string[];
  timeoutMs?: number;
};

export type BrowserWaitAction = {
  kind: "wait";
  targetId?: string;
  timeMs?: number;
  selector?: string;
  text?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  timeoutMs?: number;
};

export type BrowserEvaluateAction = {
  kind: "evaluate";
  targetId?: string;
  expression: string;
  timeoutMs?: number;
};

export type BrowserBatchAction =
  | BrowserClickAction
  | BrowserHoverAction
  | BrowserScrollIntoViewAction
  | BrowserTypeAction
  | BrowserFillAction
  | BrowserPressAction
  | BrowserDragAction
  | BrowserSelectAction
  | BrowserWaitAction;

export type BrowserBatchRequest = {
  kind: "batch";
  targetId?: string;
  actions: BrowserBatchAction[];
  stopOnError?: boolean;
  timeoutMs?: number;
};

export type BrowserActRequest = BrowserBatchAction | BrowserBatchRequest | BrowserEvaluateAction;

export type BrowserActionResult = {
  ok: true;
  profile: BrowserProfileName;
  targetId: string;
  url: string;
  details?: Record<string, unknown>;
};

export type BrowserScreenshotResponse = {
  ok: true;
  profile: BrowserProfileName;
  targetId: string;
  url: string;
  type: "png" | "jpeg";
  data: string;
};

export type BrowserConsoleMessage = {
  type: string;
  text: string;
  timestamp: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
};

export type BrowserPageError = {
  message: string;
  name?: string;
  stack?: string;
  timestamp: string;
};

export type BrowserNetworkRequest = {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  resourceType?: string;
  status?: number;
  ok?: boolean;
  failureText?: string;
};

export type BrowserStatusResponse = {
  ok: true;
  enabled: boolean;
  defaultProfile: BrowserProfileName;
  servicePort: number;
  profiles: BrowserProfile[];
};

export type BrowserOpenRequest = {
  profile?: BrowserProfileName;
  url: string;
};

export type BrowserTabTargetRequest = {
  profile?: BrowserProfileName;
  targetId: string;
};

export type BrowserNavigateRequest = {
  profile?: BrowserProfileName;
  targetId?: string;
  url: string;
  timeoutMs?: number;
};

export type BrowserSnapshotRequest = {
  profile?: BrowserProfileName;
  targetId?: string;
  format?: "ai" | "aria";
  maxChars?: number;
};

export type BrowserScreenshotRequest = {
  profile?: BrowserProfileName;
  targetId?: string;
  ref?: string;
  selector?: string;
  fullPage?: boolean;
  type?: "png" | "jpeg";
};

export type BrowserCoreClientOptions = {
  baseUrl: string;
  authToken?: string;
  backend?: "iu-browser-core" | "openclaw";
  password?: string;
  defaultProfile?: string;
  profileAliases?: Partial<Record<BrowserProfileName, string>>;
};
