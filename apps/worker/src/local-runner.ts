import "dotenv/config";
import { getPool } from "./db.js";
import { performCheck, updateMonitorState, type CheckJob } from "./checker.js";

// Local stand-in for the production pipeline (EventBridge -> SQS -> Lambda).
// Same logic, same functions, just running in a plain setInterval loop
// instead of being triggered by AWS. This file is never deployed — it's
// dev-only, see package.json's "dev" script.
const INTERVAL_MS = 15_000;

async function tick() {
  const pool = await getPool();
  const due = await pool.query<CheckJob>(
    `SELECT id, url, http_method, timeout_ms, expected_status
     FROM monitors
     WHERE status <> 'paused'
       AND (last_checked_at IS NULL
            OR last_checked_at < now() - (interval_seconds || ' seconds')::interval)`
  );

  for (const job of due.rows) {
    const result = await performCheck(job);
    await pool.query(
      `INSERT INTO check_results (monitor_id, success, status_code, response_ms, error)
       VALUES ($1, $2, $3, $4, $5)`,
      [job.id, result.success, result.statusCode ?? null, result.ms, result.error ?? null]
    );
    await updateMonitorState(job.id, result.success, result.error);
    console.log(`[checked] ${job.url} -> ${result.success ? "up" : "down"} (${result.ms}ms)`);
  }
}

console.log(`local checker running — polling every ${INTERVAL_MS / 1000}s, Ctrl+C to stop`);
tick().catch(console.error);
setInterval(() => tick().catch(console.error), INTERVAL_MS);
