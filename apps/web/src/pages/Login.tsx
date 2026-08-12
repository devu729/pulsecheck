import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";

export default function Login() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { token } = mode === "login" ? await api.login(email, password) : await api.signup(email, password);
      localStorage.setItem("pulsecheck_token", token);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div style={{ maxWidth: 360, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1>PulseCheck</h1>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p style={{ color: "#D6573F", fontSize: 13 }}>{error}</p>}
        <button type="submit">{mode === "login" ? "Log in" : "Sign up"}</button>
      </form>
      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        style={{ marginTop: 12, background: "none", border: "none", color: "#2F8C82", cursor: "pointer", padding: 0 }}
      >
        {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
      </button>
    </div>
  );
}
