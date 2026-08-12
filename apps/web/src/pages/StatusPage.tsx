import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

interface StatusData {
  monitor: { id: string; name: string; status: string; last_checked_at: string | null };
  recentChecks: { checked_at: string; success: boolean; response_ms: number }[];
}

export default function StatusPage() {
  const { monitorId } = useParams();
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/status/${monitorId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [monitorId]);

  if (error) return <p style={{ textAlign: "center", marginTop: 80 }}>Monitor not found.</p>;
  if (!data) return <p style={{ textAlign: "center", marginTop: 80 }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 480, margin: "60px auto", fontFamily: "system-ui", textAlign: "center" }}>
      <h1>{data.monitor.name}</h1>
      <p style={{ fontSize: 18, color: data.monitor.status === "up" ? "#2F8C82" : "#D6573F" }}>
        {data.monitor.status === "up" ? "● All systems operational" : `● ${data.monitor.status}`}
      </p>
      <div style={{ display: "flex", gap: 2, marginTop: 24, height: 40 }}>
        {data.recentChecks.map((c, i) => (
          <div key={i} title={new Date(c.checked_at).toLocaleString()} style={{ flex: 1, background: c.success ? "#2F8C82" : "#D6573F", borderRadius: 2 }} />
        ))}
      </div>
      <p style={{ fontSize: 12, color: "#999", marginTop: 8 }}>last {data.recentChecks.length} checks</p>
    </div>
  );
}
