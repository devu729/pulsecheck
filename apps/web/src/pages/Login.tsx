import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import PulseLine from "../components/PulseLine";

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
    <div className="pc-shell" style={{ justifyContent: "center" }}>
      <main className="pc-main pc-main-narrow" style={{ paddingTop: 0 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <PulseLine status="up" width={140} height={36} />
          <h1 className="pc-page-title" style={{ marginTop: 8 }}>PulseCheck</h1>
          <p className="pc-page-sub" style={{ marginBottom: 0 }}>Know the moment something goes down.</p>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input className="pc-field" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="pc-field" type="password" placeholder="password (min 8 chars)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          {error && <p className="pc-error">{error}</p>}
          <button type="submit" className="pc-btn pc-btn-brand">{mode === "login" ? "Log in" : "Sign up"}</button>
        </form>

        <button className="pc-btn-ghost" style={{ display: "block", margin: "16px auto 0" }} onClick={() => setMode(mode === "login" ? "signup" : "login")}>
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>
      </main>
    </div>
  );
}