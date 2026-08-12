import { SQSClient, SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import type { ScheduledHandler } from "aws-lambda";
import { getPool } from "./db.js";

const sqs = new SQSClient({});
const QUEUE_URL = process.env.CHECK_QUEUE_URL!;

interface DueMonitor {
  id: string;
  url: string;
  http_method: string;
  timeout_ms: number;
  expected_status: number;
}

// Runs every minute via EventBridge. Its only job is "what needs checking
// right now" — it never performs an HTTP call itself, so a slow or hanging
// downstream check can never delay the schedule. Actual execution happens
// in checker.ts, invoked by SQS, which scales out independently.
export const handler: ScheduledHandler = async () => {
  const pool = await getPool();

  const due = await pool.query<DueMonitor>(
    `SELECT id, url, http_method, timeout_ms, expected_status
     FROM monitors
     WHERE status <> 'paused'
       AND (last_checked_at IS NULL
            OR last_checked_at < now() - (interval_seconds || ' seconds')::interval)`
  );

  if (due.rowCount === 0) return;

  // SQS batches max 10 messages per SendMessageBatch call.
  const chunks: DueMonitor[][] = [];
  for (let i = 0; i < due.rows.length; i += 10) chunks.push(due.rows.slice(i, i + 10));

  await Promise.all(
    chunks.map((chunk) =>
      sqs.send(
        new SendMessageBatchCommand({
          QueueUrl: QUEUE_URL,
          Entries: chunk.map((m) => ({
            Id: m.id,
            MessageBody: JSON.stringify(m),
          })),
        })
      )
    )
  );

  console.log(`dispatched ${due.rowCount} monitor checks`);
};
