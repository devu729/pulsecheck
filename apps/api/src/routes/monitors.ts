import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

export const monitorsRouter = Router();
monitorsRouter.use(requireAuth);

const createMonitorSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url(),
  intervalSeconds: z.number().int().min(30).max(3600).default(60),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  isPublic: z.boolean().default(true),
});

monitorsRouter.get("/", async (req: AuthedRequest, res) => {
  const result = await pool.query(
    `SELECT id, name, url, interval_seconds, status, last_checked_at, is_public
     FROM monitors WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

monitorsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createMonitorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, url, intervalSeconds, expectedStatus, isPublic } = parsed.data;

  const result = await pool.query(
    `INSERT INTO monitors (user_id, name, url, interval_seconds, expected_status, is_public)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, url, interval_seconds, status, is_public`,
    [req.userId, name, url, intervalSeconds, expectedStatus, isPublic]
  );
  res.status(201).json(result.rows[0]);
});

// Uptime % and average latency, derived on read from check_results —
// never stored redundantly, so it's always consistent with raw data.
monitorsRouter.get("/:id/stats", async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const windowHours = Math.min(Number(req.query.hours ?? 24), 24 * 30);

  const owns = await pool.query(`SELECT 1 FROM monitors WHERE id = $1 AND user_id = $2`, [id, req.userId]);
  if (owns.rowCount === 0) return res.status(404).json({ error: "monitor not found" });

  const stats = await pool.query(
    `SELECT
       count(*) FILTER (WHERE success) AS successes,
       count(*) AS total,
       round(avg(response_ms))::int AS avg_response_ms
     FROM check_results
     WHERE monitor_id = $1 AND checked_at > now() - ($2 || ' hours')::interval`,
    [id, windowHours]
  );
  const row = stats.rows[0];
  const total = Number(row.total);
  const uptimePct = total === 0 ? null : (Number(row.successes) / total) * 100;

  const incidents = await pool.query(
    `SELECT id, opened_at, resolved_at, cause FROM incidents
     WHERE monitor_id = $1 ORDER BY opened_at DESC LIMIT 20`,
    [id]
  );

  res.json({
    windowHours,
    uptimePct,
    avgResponseMs: row.avg_response_ms,
    totalChecks: total,
    incidents: incidents.rows,
  });
});

monitorsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await pool.query(`DELETE FROM monitors WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.status(204).send();
});
