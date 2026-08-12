-- PulseCheck core schema

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE monitors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  http_method       TEXT NOT NULL DEFAULT 'GET',
  interval_seconds  INTEGER NOT NULL DEFAULT 60,
  timeout_ms        INTEGER NOT NULL DEFAULT 5000,
  expected_status   INTEGER NOT NULL DEFAULT 200,
  is_public         BOOLEAN NOT NULL DEFAULT true,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'up', 'degraded', 'down', 'paused')),
  consecutive_fails INTEGER NOT NULL DEFAULT 0,
  last_checked_at   TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_monitors_due
  ON monitors (last_checked_at)
  WHERE status <> 'paused';

-- One row per executed check. This is the time-series table; in production
-- this is exactly the kind of table you'd later partition by month or move
-- to Timestream/TimescaleDB once volume grows.
CREATE TABLE check_results (
  id              BIGSERIAL PRIMARY KEY,
  monitor_id      UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  success         BOOLEAN NOT NULL,
  status_code     INTEGER,
  response_ms     INTEGER,
  error           TEXT
);

CREATE INDEX idx_check_results_monitor_time
  ON check_results (monitor_id, checked_at DESC);

-- Incident = a state machine, not just a log line. Opens on N consecutive
-- failures, closes on the first recovery. uptime/MTTR are derived from this
-- table plus check_results, never stored redundantly.
CREATE TABLE incidents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id    UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  cause         TEXT,
  notified_at   TIMESTAMPTZ
);

CREATE INDEX idx_incidents_open
  ON incidents (monitor_id)
  WHERE resolved_at IS NULL;
