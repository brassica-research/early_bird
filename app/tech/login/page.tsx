"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setup = params.get("setup") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [need2fa, setNeed2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tech/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, token: token || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.need2fa) setNeed2fa(true);
        setError(data.error || "Sign-in failed.");
        return;
      }
      router.push("/tech");
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 420 }}>
        <p className="eyebrow">Technician</p>
        <h2 className="section-title">Sign in</h2>

        {setup && (
          <div className="alert alert-warn">
            Technician access isn’t configured yet. Set a <code>TECH_PASSCODE</code>{" "}
            (the invite code) to enable sign-ups.
          </div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="card" style={{ padding: 22 }} onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div
            className="form-field"
            style={{ marginBottom: need2fa ? undefined : 16 }}
          >
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {need2fa && (
            <div className="form-field" style={{ marginBottom: 16 }}>
              <label htmlFor="code">Authenticator code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="spin" /> Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </div>
        </form>

        <div
          className="row"
          style={{ justifyContent: "space-between", marginTop: 14 }}
        >
          <Link href="/tech/forgot" className="muted" style={{ fontWeight: 600 }}>
            Forgot password?
          </Link>
          <Link href="/tech/register" style={{ fontWeight: 700 }}>
            Create account →
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function TechLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
