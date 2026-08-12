import { useEffect, useState } from "react";
import { api, type Monitor } from "../lib/api";

const STATUS_COLOR: Record<Monitor["status"], string> = {
  up: "#2F8C82",
  degraded: "#E3A63C",
  down: "#D6573F",
  paused: "#9AA39B",
  pending: "#9AA39B",
};

export default function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => api.listMonitors().then(setMonitors).finally(() => setLoading(false));

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000); // poll for live status; swap for WS/SSE later
    return () => clearInterval(interval);
  }, []);

  const addMonitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url) return;
    await api.createMonitor({ name, url });
    setName(""); setUrl("");
    load();
  };

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Monitors</h1>

      <form onSubmit={addMonitor} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        <button type="submit">Add monitor</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {monitors.map((m) => (
            <li key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: STATUS_COLOR[m.status] }} />
              <strong>{m.name}</strong>
              <span style={{ color: "#777", fontSize: 13 }}>{m.url}</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#999" }}>
                {m.last_checked_at ? new Date(m.last_checked_at).toLocaleTimeString() : "not checked yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
