import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { SQSHandler } from "aws-lambda";
import { getPool } from "./db.js";

const ses = new SESv2Client({});
const ALERT_FROM = process.env.ALERT_FROM_EMAIL ?? "alerts@pulsecheck.dev";
const FAILURE_THRESHOLD = 3;

export interface CheckJob {
  id: string;
  url: string;
  http_method: string;
  timeout_ms: number;
  expected_status: number;
}

export async function performCheck(job: CheckJob): Promise<{ success: boolean; statusCode?: number; ms: number; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), job.timeout_ms);
  try {
    const res = await fetch(job.url, { method: job.http_method, signal: controller.signal });
    return { success: res.status === job.expected_status, statusCode: res.status, ms: Date.now() - start };
  } catch (err) {
    return { success: false, ms: Date.now() - start, error: (err as Error).message };
  } finally {
    clearTimeout(timeout);
  }
}

// One SQS record per monitor check. Batch failures partial-fail via
// batchItemFailures so a single bad monitor doesn't cause the whole batch
// to be retried.
export const handler: SQSHandler = async (event) => {
  const pool = await getPool();
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const job: CheckJob = JSON.parse(record.body);
      const result = await performCheck(job);

      await pool.query(
        `INSERT INTO check_results (monitor_id, success, status_code, response_ms, error)
         VALUES ($1, $2, $3, $4, $5)`,
        [job.id, result.success, result.statusCode ?? null, result.ms, result.error ?? null]
      );

      await updateMonitorState(job.id, result.success, result.error);
    } catch (err) {
      console.error("check failed", record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

export async function updateMonitorState(monitorId: string, success: boolean, error?: string) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const current = await client.query<{ consecutive_fails: number; status: string; name: string }>(
      `SELECT consecutive_fails, status, name FROM monitors WHERE id = $1 FOR UPDATE`,
      [monitorId]
    );
    const monitor = current.rows[0];
    if (!monitor) { await client.query("ROLLBACK"); return; }

    if (success) {
      await client.query(
        `UPDATE monitors SET status = 'up', consecutive_fails = 0, last_checked_at = now() WHERE id = $1`,
        [monitorId]
      );
      // Recovery: close any open incident.
      const resolved = await client.query<{ id: string; opened_at: string }>(
        `UPDATE incidents SET resolved_at = now()
         WHERE monitor_id = $1 AND resolved_at IS NULL
         RETURNING id, opened_at`,
        [monitorId]
      );
      if (resolved.rowCount && resolved.rowCount > 0) {
        await notify(monitor.name, `Recovered — back up as of now.`);
      }
    } else {
      const fails = monitor.consecutive_fails + 1;
      const status = fails >= FAILURE_THRESHOLD ? "down" : "degraded";
      await client.query(
        `UPDATE monitors SET status = $2, consecutive_fails = $3, last_checked_at = now() WHERE id = $1`,
        [monitorId, status, fails]
      );

      if (fails === FAILURE_THRESHOLD) {
        await client.query(
          `INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2)`,
          [monitorId, error ?? "health check failed"]
        );
        await notify(monitor.name, `DOWN after ${fails} consecutive failed checks. Cause: ${error ?? "unknown"}`);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function notify(monitorName: string, message: string) {
  const to = process.env.ALERT_TO_EMAIL;
  if (!to) return; // no recipient configured — skip silently in dev
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: ALERT_FROM,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: `[PulseCheck] ${monitorName}` },
          Body: { Text: { Data: message } },
        },
      },
    })
  );
}
