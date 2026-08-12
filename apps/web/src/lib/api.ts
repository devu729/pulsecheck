const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

export interface Monitor {
  id: string;
  name: string;
  url: string;
  interval_seconds: number;
  status: "pending" | "up" | "degraded" | "down" | "paused";
  last_checked_at: string | null;
  is_public: boolean;
}

export interface MonitorStats {
  windowHours: number;
  uptimePct: number | null;
  avgResponseMs: number | null;
  totalChecks: number;
  incidents: { id: string; opened_at: string; resolved_at: string | null; cause: string | null }[];
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("pulsecheck_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  signup: (email: string, password: string) =>
    request<{ token: string }>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  listMonitors: () => request<Monitor[]>("/monitors"),
  createMonitor: (input: { name: string; url: string; intervalSeconds?: number }) =>
    request<Monitor>("/monitors", { method: "POST", body: JSON.stringify(input) }),
  monitorStats: (id: string, hours = 24) => request<MonitorStats>(`/monitors/${id}/stats?hours=${hours}`),
  deleteMonitor: (id: string) => request<void>(`/monitors/${id}`, { method: "DELETE" }),
};
