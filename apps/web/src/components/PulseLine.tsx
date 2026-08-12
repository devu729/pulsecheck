import "./PulseLine.css";

type Status = "up" | "degraded" | "down" | "pending" | "paused";

const COLORS: Record<Status, string> = {
  up: "#1F9D6C",
  degraded: "#C4841E",
  down: "#C7402F",
  pending: "#8A968E",
  paused: "#8A968E",
};

// One ECG-style repeating unit: a flat run, then a beat (small dip, tall
// spike, small dip), back to flat. Tiled twice inside a wider viewBox and
// scrolled via CSS to read as a continuous live trace.
const BEAT_UP = "M0,20 L18,20 L23,26 L28,4 L33,30 L38,20 L80,20";
const BEAT_DEGRADED = "M0,20 L10,20 L14,28 L18,8 L22,26 L26,14 L30,20 L48,20 L52,25 L56,10 L60,22 L64,20 L80,20";
const FLAT = "M0,20 L80,20";

function tracePath(status: Status): string {
  if (status === "up") return BEAT_UP;
  if (status === "degraded") return BEAT_DEGRADED;
  return FLAT; // down / pending / paused all read as a flatline, the point of the metaphor
}

export default function PulseLine({ status, width = 120, height = 32 }: { status: Status; width?: number; height?: number }) {
  const path = tracePath(status);
  const animated = status === "up" || status === "degraded";

  return (
    <svg
      className={`pc-pulseline ${animated ? "pc-pulseline-animated" : ""}`}
      width={width}
      height={height}
      viewBox="0 0 160 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g className="pc-pulseline-track">
        <path d={path} fill="none" stroke={COLORS[status]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path} fill="none" stroke={COLORS[status]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="translate(80, 0)" />
      </g>
    </svg>
  );
}