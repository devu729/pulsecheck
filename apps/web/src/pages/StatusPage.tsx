import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import PulseLine from "../components/PulseLine";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

interface StatusData {
  monitor: { id: string; name: string; status: "up" | "degraded" | "down" | "pending" | "paused"; last_checked_at: string | null };
  recentChecks: { checked_at: string; success: boolean; response_ms: number }[];
}

const STATUS_TEXT: Record<StatusData["monitor"]["status"], string> = {
  up: "All systems operational",
  degraded: "Degraded performance",
  down: "Service down",
  pending: "Awaiting first check",
  paused: "Monitoring paused",
};

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

  if (error) return <p className="pc-center-loading">Monitor not found.</p>;
  if (!data) return <p className="pc-center-loading">loading\u2026</p>;

  const { monitor, recentChecks } = data;

  return (
    <div className="pc-shell">
      <main className="pc-main pc-main-narrow">
        <div className="pc-status-hero">
          <p className="pc-status-name">{monitor.name}</p>
          <span className="pc-status-line">
            <span className={`pc-status-dot ${monitor.status}`} />
            {STATUS_TEXT[monitor.status]}
          </span>
          <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
            <PulseLine status={monitor.status} width={180} height={44} />
          </div>
        </div>

        {recentChecks.length > 0 && (
          <>
            <div className="pc-history">
              {recentChecks.map((c, i) => (
                <div
                  key={i}
                  title={new Date(c.checked_at).toLocaleString()}
                  className="pc-history-bar"
                  style={{ background: c.success ? "#1F9D6C" : "#C7402F" }}
                />
              ))}
            </div>
            <p className="pc-history-caption">last {recentChecks.length} checks</p>
          </>
        )}
      </main>
    </div>
  );
}