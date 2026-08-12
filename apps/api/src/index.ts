import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { monitorsRouter } from "./routes/monitors.js";
import { statusRouter } from "./routes/status.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/monitors", monitorsRouter);
app.use("/status", statusRouter);

// Centralized error handler — every route above can just `throw` or let a
// rejected promise propagate.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`pulsecheck api listening on :${port}`));
