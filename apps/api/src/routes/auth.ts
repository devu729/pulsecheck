import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { signToken } from "../middleware/auth.js";

export const authRouter = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

authRouter.post("/signup", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [email, passwordHash]
    );
    const userId = result.rows[0]!.id;
    res.status(201).json({ token: signToken(userId) });
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "email already registered" });
    throw err;
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { email, password } = parsed.data;
  const result = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE email = $1`,
    [email]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "invalid email or password" });
  }
  res.json({ token: signToken(user.id) });
});
