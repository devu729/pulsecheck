import { Router } from "express";
import { pool } from "../db/pool.js";

export const statusRouter = Router();

// Public status page data — no auth. Only monitors flagged is_public are
// ever exposed here, and only their current status, never owner info.
statusRouter.get("/:monitorId", async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, status, last_checked_at
     FROM monitors WHERE id = $1 AND is_public = true`,
    [req.params.monitorId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "not found" });

  const recent = await pool.query(
    `SELECT checked_at, success, response_ms
     FROM check_results WHERE monitor_id = $1
     ORDER BY checked_at DESC LIMIT 90`,
    [req.params.monitorId]
  );

  res.json({ monitor: result.rows[0], recentChecks: recent.rows.reverse() });
});
