import { Pool } from "pg";

// Local dev: a single DATABASE_URL from .env (see .env.example).
// Production (ECS): discrete DB_HOST/DB_USER/DB_PASSWORD/DB_NAME, where
// DB_USER and DB_PASSWORD are injected directly from Secrets Manager by the
// ECS task definition (ecs.Secret.fromSecretsManager) — the password is
// never rendered into the CloudFormation template or an env var literal,
// ECS resolves it at container start. See infra/lib/pulsecheck-stack.ts.
const connectionConfig = process.env.DB_HOST
  ? {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
    }
  : { connectionString: process.env.DATABASE_URL ?? "postgres://pulsecheck:pulsecheck@localhost:5432/pulsecheck" };

export const pool = new Pool({ ...connectionConfig, max: 10, idleTimeoutMillis: 30_000 });

export async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
