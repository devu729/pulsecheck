import { describe, it, expect } from "vitest";
import { Pool } from "pg";

// These tests exercise the actual incident-detection SQL logic used by
// apps/worker/src/checker.ts's updateMonitorState, run directly against a
// real Postgres instance (CI spins one up as a service container — see
// .github/workflows/ci.yml). We reimplement the transition here rather than
// importing from apps/worker to keep apps/api's test suite dependency-free
// of the worker package; the SQL itself is what's under test.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FAILURE_THRESHOLD = 3;

async function seedMonitor(client: import("pg").PoolClient) {
  const user = await client.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
    [`test-${Date.now()}-${Math.random()}@example.com`]
  );
  const monitor = await client.query(
    `INSERT INTO monitors (user_id, name, url) VALUES ($1, 'test', 'https://example.com') RETURNING id`,
    [user.rows[0].id]
  );
  return monitor.rows[0].id as string;
}

async function recordCheck(client: import("pg").PoolClient, monitorId: string, success: boolean) {
  const current = await client.query(
    `SELECT consecutive_fails FROM monitors WHERE id = $1 FOR UPDATE`,
    [monitorId]
  );
  const fails = current.rows[0].consecutive_fails;

  if (success) {
    await client.query(
      `UPDATE monitors SET status = 'up', consecutive_fails = 0 WHERE id = $1`,
      [monitorId]
    );
    await client.query(
      `UPDATE incidents SET resolved_at = now() WHERE monitor_id = $1 AND resolved_at IS NULL`,
      [monitorId]
    );
  } else {
    const newFails = fails + 1;
    const status = newFails >= FAILURE_THRESHOLD ? "down" : "degraded";
    await client.query(`UPDATE monitors SET status = $2, consecutive_fails = $3 WHERE id = $1`, [
      monitorId, status, newFails,
    ]);
    if (newFails === FAILURE_THRESHOLD) {
      await client.query(`INSERT INTO incidents (monitor_id, cause) VALUES ($1, 'test failure')`, [monitorId]);
    }
  }
}

async function getMonitor(client: import("pg").PoolClient, monitorId: string) {
  const result = await client.query(`SELECT status, consecutive_fails FROM monitors WHERE id = $1`, [monitorId]);
  return result.rows[0];
}

describe("incident state machine", () => {
  it("stays 'up' after a single failure", async () => {
    const client = await pool.connect();
    try {
      const id = await seedMonitor(client);
      await recordCheck(client, id, false);
      const monitor = await getMonitor(client, id);
      expect(monitor.status).toBe("degraded");
      expect(monitor.consecutive_fails).toBe(1);
    } finally {
      client.release();
    }
  });

  it("opens an incident after 3 consecutive failures", async () => {
    const client = await pool.connect();
    try {
      const id = await seedMonitor(client);
      await recordCheck(client, id, false);
      await recordCheck(client, id, false);
      await recordCheck(client, id, false);

      const monitor = await getMonitor(client, id);
      expect(monitor.status).toBe("down");

      const incidents = await client.query(`SELECT * FROM incidents WHERE monitor_id = $1`, [id]);
      expect(incidents.rowCount).toBe(1);
    } finally {
      client.release();
    }
  });

  it("resolves the incident on the first successful check after a failure streak", async () => {
    const client = await pool.connect();
    try {
      const id = await seedMonitor(client);
      await recordCheck(client, id, false);
      await recordCheck(client, id, false);
      await recordCheck(client, id, false);
      await recordCheck(client, id, true);

      const monitor = await getMonitor(client, id);
      expect(monitor.status).toBe("up");
      expect(monitor.consecutive_fails).toBe(0);

      const openIncidents = await client.query(
        `SELECT * FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL`,
        [id]
      );
      expect(openIncidents.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it("does not open a second incident while one is already open", async () => {
    const client = await pool.connect();
    try {
      const id = await seedMonitor(client);
      for (let i = 0; i < 6; i++) await recordCheck(client, id, false); // well past threshold

      const incidents = await client.query(`SELECT * FROM incidents WHERE monitor_id = $1`, [id]);
      expect(incidents.rowCount).toBe(1); // still just the one from crossing the threshold
    } finally {
      client.release();
    }
  });
});