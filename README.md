# PulseCheck

An uptime and incident monitoring tool. Add a URL, it gets checked on an
interval, and if it goes down for three checks in a row an incident opens
and an email goes out.

The interesting part isn't the CRUD — it's that checking a URL and serving
the dashboard are two completely separate systems, connected by a queue,
which is how actual monitoring platforms (Pingdom, UptimeRobot, etc.) are
built and why.

```
                 ┌──────────────┐        ┌────────────────┐
   React (S3 +   │   API        │        │  EventBridge     │  every 1 min
   CloudFront) ──▶│  (Express,   │        │  cron rule       │──────────┐
                 │   TS, ECS)   │        └────────────────┘          ▼
                 └──────┬───────┘                              ┌───────────┐
                        │                                      │ Dispatcher │
                        ▼                                      │  Lambda    │
                 ┌──────────────┐   monitors due for check     └─────┬─────┘
                 │  Postgres    │◀─────────────────────────────────┐  │
                 │  (RDS)       │                                  │  ▼
                 └──────┬───────┘                            ┌───────────┐
                        ▲                                    │    SQS    │
                        │        check results / incidents   │  queue    │
                        │      ┌──────────────────────────────└─────┬─────┘
                        │      │                                    │
                        │      ▼                                    ▼
                        │ ┌──────────────┐  fan-out, N in parallel
                        └─│   Checker    │◀─────────────────────────┘
                          │   Lambda(s)  │
                          └──────────────┘
                                 │
                                 ▼ 3+ consecutive failures
                          ┌──────────────┐
                          │  SES email   │
                          └──────────────┘
```

## Why it's split up this way

The API (Express, always running on ECS) handles auth, CRUD, and dashboard
queries. It never makes an outbound HTTP call to check anything itself.

Instead, a Lambda on a 1-minute EventBridge schedule looks at which monitors
are due for a check and drops one message per monitor onto an SQS queue —
it doesn't do the checking, just the "what needs doing." A second Lambda,
triggered by that queue, does the actual HTTP request, writes the result to
Postgres, and updates the monitor's state.

Splitting it this way means a slow or hanging check on one URL can't delay
checks on anything else, and the checker Lambdas can scale out independently
of the API's capacity — SQS handles the fan-out for free.

A monitor's status is a small state machine (`up → degraded → down`), not
just a log of pass/fail rows. An incident opens once three checks in a row
fail, and closes on the first success after that. Uptime percentage and
average response time are computed on read from `check_results`, not stored
anywhere redundantly, so they can't drift out of sync with the raw data.

Infrastructure is AWS CDK, in TypeScript — `cdk deploy` provisions the VPC,
RDS instance, the Lambda/SQS/EventBridge pipeline, the ECS service, and the
S3 + CloudFront frontend, no manual console setup.

## Stack

| Layer          | Choice                                                |
|----------------|--------------------------------------------------------|
| Frontend       | React + TypeScript, Vite, on S3 + CloudFront            |
| API            | Node + TypeScript + Express, on ECS Fargate             |
| Check pipeline | AWS Lambda (dispatcher + checker), EventBridge, SQS     |
| Database       | PostgreSQL on RDS                                       |
| Alerts         | SES                                                     |
| Infra          | AWS CDK (TypeScript)                                    |
| CI             | GitHub Actions — typecheck + integration tests on every push |

## Repo layout

```
apps/api      Express API — auth, monitors CRUD, dashboard queries, public status pages
apps/worker   The check pipeline: dispatcher.ts + checker.ts (Lambda), local-runner.ts (dev)
apps/web      React dashboard + public status page
infra         AWS CDK stack: VPC, RDS, ECS, Lambda, SQS, EventBridge, S3, CloudFront, SES
db            SQL migrations
```

## Running it locally

No Docker required — point it at a free [Neon](https://neon.tech) Postgres
instance instead of running one locally.

```bash
npm install
cp apps/api/.env.example apps/api/.env       # fill in DATABASE_URL
cp apps/worker/.env.example apps/worker/.env  # same DATABASE_URL
npm run migrate

npm run dev:api      # terminal 1 — :4000
npm run dev:web      # terminal 2 — :5173
npm run dev:worker   # terminal 3 — polls and checks monitors every 15s
```

## Deploying

```bash
cd infra
npm run build -w apps/worker
npm run build -w apps/web
npx cdk bootstrap   # once per AWS account/region
npx cdk deploy
```