import { useEffect, useState } from "react";
import { api, type Monitor } from "../lib/api";
import PulseLine from "../components/PulseLine";

const STATUS_LABEL: Record<Monitor["status"], string> = {
  up: "up",
  degraded: "degraded",
  down: "down",
  paused: "paused",
  pending: "pending",
};

function relativeTime(iso: string | null): string {
  if (!iso) return "never checked";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  return `${Math.floor(diffSec / 3600)}h ago`;
}

export default function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => api.listMonitors().then(setMonitors).catch(() => {}).finally(() => setLoading(false));

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, []);

  const addMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name || !url) return;
    try {
      await api.createMonitor({ name, url });
      setName(""); setUrl("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="pc-shell">
      <header className="pc-topbar">
        <a href="/" className="pc-wordmark">
          <span className="pc-wordmark-dot" />
          PulseCheck
        </a>
        <button
          className="pc-btn-ghost"
          onClick={() => { localStorage.removeItem("pulsecheck_token"); window.location.href = "/login"; }}
        >
          Log out
        </button>
      </header>

      <main className="pc-main">
        <h1 className="pc-page-title">Monitors</h1>
        <p className="pc-page-sub">Every monitor here is checked on its own interval and flips state on three consecutive failures.</p>

        <form onSubmit={addMonitor} className="pc-add-row">
          <input className="pc-field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="pc-field" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="pc-btn pc-btn-brand">Add monitor</button>
        </form>
        {error && <p className="pc-error">{error}</p>}

        {loading ? (
          <p className="pc-center-loading">loading\u2026</p>
        ) : monitors.length === 0 ? (
          <p className="pc-empty">No monitors yet \u2014 add a URL above to start watching it.</p>
        ) : (
          <ul className="pc-monitor-list">
            {monitors.map((m) => (
              <li key={m.id} className="pc-monitor-row">
                <PulseLine status={m.status} width={80} height={26} />
                <div>
                  <div className="pc-monitor-name">{m.name}</div>
                  <span className="pc-monitor-url">{m.url}</span>
                </div>
                <span className={`pc-status-pill ${m.status}`}>{STATUS_LABEL[m.status]}</span>
                <span className="pc-timestamp">{relativeTime(m.last_checked_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}