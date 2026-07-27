"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setup = params.get("setup") === "1";
  const nextParam = params.get("next");

  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed.");
        return;
      }
      // Resolve the destination at runtime so it also works behind a
      // non-obvious admin path. `next` is same-origin (set by middleware).
      const home = window.location.pathname.replace(/\/login$/, "");
      const dest =
        nextParam && nextParam.startsWith("/") && !nextParam.endsWith("/login")
          ? nextParam
          : home;
      router.push(dest);
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
        <p className="eyebrow">Operations</p>
        <h2 className="section-title">Admin sign-in</h2>

        {setup && (
          <div className="alert alert-warn">
            Admin access isn’t configured yet. Set an <code>ADMIN_PASSWORD</code>{" "}
            environment variable, then sign in here.
          </div>
        )}
        {error && <div className="alert alert-danger">{error}</div>}

        <form className="card" style={{ padding: 22 }} onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="pw">Admin password</label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>
          <div className="form-field" style={{ marginBottom: 16 }}>
            <label htmlFor="code">
              Authenticator code{" "}
              <span className="hint">— if two-factor is enabled</span>
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
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
      </div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
