import { Pool } from "pg";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Module-level singletons: Lambda reuses the execution environment across
// warm invocations, so the pool (and the resolved secret) survive between
// calls instead of reconnecting/re-fetching every time.
let pool: Pool | undefined;
let cachedDatabaseUrl: string | undefined;

async function resolveDatabaseUrl(): Promise<string> {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL; // local dev
  if (cachedDatabaseUrl) return cachedDatabaseUrl;

  // Production: the password is never in an env var or the CFN template —
  // fetched once per cold start via Secrets Manager, using IAM permissions
  // granted to the function (database.secret.grantRead(fn) in the CDK stack).
  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN! }));
  const { username, password } = JSON.parse(result.SecretString!);
  cachedDatabaseUrl = `postgres://${username}:${encodeURIComponent(password)}@${process.env.DB_HOST}:5432/${process.env.DB_NAME}`;
  return cachedDatabaseUrl;
}

export async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = new Pool({
      connectionString: await resolveDatabaseUrl(),
      max: 2, // small per-instance cap; Lambda scales out horizontally instead
      idleTimeoutMillis: 10_000,
    });
  }
  return pool;
}
