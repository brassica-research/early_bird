"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Me = { id: string; name: string; email: string; twoFactorEnabled: boolean };

export default function TechSecurityPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/tech/me");
    if (!res.ok) {
      router.push("/tech/login");
      return;
    }
    setMe((await res.json()).tech);
    setReady(true);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function beginSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tech/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not start setup.");
        return;
      }
      setSetup({ secret: data.secret, otpauthUrl: data.otpauthUrl });
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tech/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not enable two-factor.");
        return;
      }
      setSetup(null);
      setCode("");
      setMsg("Two-factor is now on. You’ll enter a code at each sign-in.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tech/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not disable two-factor.");
        return;
      }
      setCode("");
      setMsg("Two-factor has been turned off.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <main className="section" />;

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 520 }}>
        <div className="spread">
          <div>
            <p className="eyebrow">Technician · Security</p>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Two-factor authentication
            </h2>
          </div>
          <Link href="/tech" className="btn btn-ghost">
            ← Back
          </Link>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {msg && <div className="alert alert-ok">{msg}</div>}

        {me?.twoFactorEnabled ? (
          <div className="card" style={{ padding: 22 }}>
            <p style={{ marginTop: 0 }}>
              <span className="badge badge-ok">On</span> Your account is protected
              by an authenticator app.
            </p>
            <form onSubmit={disable}>
              <div className="form-field">
                <label htmlFor="dcode">Enter a current code to turn it off</label>
                <input
                  id="dcode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              </div>
              <div className="form-actions">
                <button className="btn btn-ghost" disabled={busy}>
                  Turn off two-factor
                </button>
              </div>
            </form>
          </div>
        ) : setup ? (
          <div className="card" style={{ padding: 22 }}>
            <p style={{ marginTop: 0 }}>
              <strong>1.</strong> Add this account to your authenticator app
              (Google Authenticator, 1Password, Authy…). Scan the link as a QR
              code, or enter the key manually:
            </p>
            <div className="form-field">
              <label htmlFor="setupkey">Setup key</label>
              <input
                id="setupkey"
                readOnly
                value={setup.secret}
                onFocus={(e) => e.target.select()}
              />
            </div>
            <details style={{ marginBottom: 12 }}>
              <summary className="muted" style={{ cursor: "pointer" }}>
                Show otpauth link (for a QR generator)
              </summary>
              <code
                style={{
                  display: "block",
                  wordBreak: "break-all",
                  fontSize: "0.78rem",
                  marginTop: 8,
                }}
              >
                {setup.otpauthUrl}
              </code>
            </details>
            <form onSubmit={enable}>
              <div className="form-field">
                <label htmlFor="ecode">
                  <strong>2.</strong> Enter the 6-digit code it shows
                </label>
                <input
                  id="ecode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "Verifying…" : "Turn on two-factor"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="card" style={{ padding: 22 }}>
            <p style={{ marginTop: 0 }}>
              <span className="badge badge-low">Off</span> Add a second factor
              from an authenticator app for stronger account protection.
            </p>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={beginSetup} disabled={busy}>
                {busy ? "Starting…" : "Set up two-factor"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
