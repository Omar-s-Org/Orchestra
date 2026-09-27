/**
 * The single entry point for every API call.
 *
 * - adds the bearer token from localStorage.token
 * - parses `{ error }` bodies and throws ApiError(status, message)
 * - on 401: clears the token and returns to /login?next=... once
 * - serves the same endpoints from mock.ts when the backend is unreachable
 */
import { handleMock, MockError } from "./mock";
import type {
  AgentKey,
  GraphData,
  KbDoc,
  KbSummary,
  LiveAgent,
  LoginResponse,
  Me,
  Overview,
  TaskDetail,
  TaskSummary,
  Update,
  DemoAccount,
} from "./types";

import { API_BASES } from "./config";

export const DEFAULT_API_BASE = API_BASES[0];
const LEGACY_BASE = "http://localhost:8787";

export type MockMode = "auto" | "on" | "off";
export type DataSource = "live" | "mock";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* ----------------------------- storage ----------------------------- */

const hasWindow = () => typeof window !== "undefined";

function read(key: string): string | null {
  if (!hasWindow()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  if (!hasWindow()) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function getApiBase(): string {
  const stored = read("apiBase");
  return stored && stored !== LEGACY_BASE ? stored : DEFAULT_API_BASE;
}

export function setApiBase(base: string) {
  write("apiBase", base.trim().replace(/\/$/, "") || DEFAULT_API_BASE);
  notify();
}

export function getToken(): string | null {
  return read("token");
}

export function setToken(token: string) {
  write("token", token);
}

export function clearToken() {
  write("token", null);
}

export function getMockMode(): MockMode {
  const value = read("mockMode");
  return value === "on" || value === "auto" ? value : "off";
}

export function setMockMode(mode: MockMode) {
  write("mockMode", mode);
  if (mode === "on") setSource("mock");
  if (mode !== "on") void checkHealth();
  notify();
}

/* -------------------------- source tracking ------------------------ */

let source: DataSource = "mock";
const listeners = new Set<() => void>();
const flipListeners = new Set<(next: DataSource) => void>();
let started = false;

function notify() {
  listeners.forEach((l) => l());
}

function setSource(next: DataSource) {
  if (source === next) return;
  source = next;
  notify();
  flipListeners.forEach((l) => l(next));
}

export function getSource(): DataSource {
  return source;
}

export function subscribeSource(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called once when auto mode flips between live and mock. */
export function onSourceFlip(listener: (next: DataSource) => void) {
  flipListeners.add(listener);
  return () => flipListeners.delete(listener);
}

function useMock(): boolean {
  const mode = getMockMode();
  if (mode === "on") return true;
  if (mode === "off") return false;
  return source === "mock";
}

async function checkHealth() {
  if (!hasWindow()) return;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${getApiBase()}/api/health`, { signal: controller.signal });
    setSource(res.ok ? "live" : "mock");
  } catch {
    setSource("mock");
  } finally {
    window.clearTimeout(timer);
  }
}

/** Starts the auto-mode health monitor (every 10s). Safe to call repeatedly. */
export function startSourceMonitor() {
  if (started || !hasWindow()) return;
  started = true;
  const run = () => {
    if (getMockMode() !== "on") void checkHealth();
  };
  run();
  window.setInterval(run, 10_000);
}

/* --------------------------- 401 handling -------------------------- */

let redirecting = false;

function handleUnauthorized() {
  clearToken();
  if (!hasWindow() || redirecting) return;
  if (window.location.pathname === "/login") return;
  redirecting = true;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

/* ----------------------------- request ----------------------------- */

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const token = getToken();

  if (useMock()) {
    await new Promise((r) => setTimeout(r, 120));
    try {
      return handleMock(method, path, token, body) as T;
    } catch (error) {
      if (error instanceof MockError) {
        if (error.status === 401) handleUnauthorized();
        throw new ApiError(error.status, error.message);
      }
      throw error;
    }
  }

  let res: Response;
  try {
    const init: RequestInit = {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
    if (body) init.body = JSON.stringify(body);
    res = await fetch(`${getApiBase()}${path}`, init);
  } catch {
    if (getMockMode() === "auto") setSource("mock");
    throw new ApiError(0, "Cannot reach the backend");
  }

  const text = await res.text();
  const data: unknown = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : null) ?? `Request failed (${res.status})`;
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(res.status, message);
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function query(params: Record<string, string | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/* ---------------------------- endpoints ---------------------------- */

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("POST", "/api/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  me: () => request<Me>("GET", "/api/me"),
  agentKey: () => request<AgentKey>("GET", "/api/me/agent-key"),
  tasks: (filters: { status?: string | undefined; department?: string | undefined; person?: string | undefined; mine?: boolean } = {}) =>
    request<TaskSummary[]>("GET", `/api/tasks${query(filters)}`),
  task: (id: string) => request<TaskDetail>("GET", `/api/tasks/${id}`),
  approve: (id: string, note?: string) =>
    request<TaskDetail>("POST", `/api/tasks/${id}/approve`, { note }),
  reopen: (id: string, note: string) =>
    request<TaskDetail>("POST", `/api/tasks/${id}/reopen`, { note }),
  activity: (filters: { limit?: number; task?: string | undefined; via?: string | undefined; kind?: string | undefined } = {}) =>
    request<Update[]>(
      "GET",
      `/api/activity${query({ ...filters, limit: String(filters.limit ?? 50) })}`,
    ),
  liveAgents: () => request<LiveAgent[]>("GET", "/api/agents/live"),
  overview: () => request<Overview>("GET", "/api/overview"),
  graph: () => request<GraphData>("GET", "/api/graph"),
  kb: (q?: string) => request<KbSummary[]>("GET", `/api/kb${query({ q })}`),
  kbDoc: (id: string) => request<KbDoc>("GET", `/api/kb/${id}`),
  /** Public: the accounts of the project the backend has loaded (login quick-fill). */
  demoAccounts: () => request<DemoAccount[]>("GET", "/api/demo/accounts"),
};

/** Artifact URLs: relative paths are served by the backend with the token. */
export function artifactUrl(url: string): string {
  if (/^https?:|^data:|^\//.test(url) && !url.startsWith("/api/")) return url;
  return `${getApiBase()}${url}?token=${encodeURIComponent(getToken() ?? "")}`;
}
