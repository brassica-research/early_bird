"use client";

import { useState } from "react";
import Link from "next/link";

export default function TechForgotPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/tech/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      // Always generic — never reveals whether the email is registered.
      setMessage(
        data.message ||
          "If an account exists for that email, a reset link is on its way.",
      );
    } catch {
      setMessage(
        "If an account exists for that email, a reset link is on its way.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 420 }}>
        <p className="eyebrow">Technician</p>
        <h2 className="section-title">Reset your password</h2>

        {message ? (
          <>
            <div className="alert alert-ok">{message}</div>
            <p className="muted">
              The link expires in 30 minutes and can be used once. Check your
              spam folder if you don’t see it.
            </p>
            <Link href="/tech/login" style={{ fontWeight: 700 }}>
              ← Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Enter your account email and we’ll send a reset link.
            </p>
            <form className="card" style={{ padding: 22 }} onSubmit={submit}>
              <div className="form-field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="form-actions">
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? (
                    <>
                      <span className="spin" /> Sending…
                    </>
                  ) : (
                    "Send reset link"
                  )}
                </button>
              </div>
            </form>
            <div className="row" style={{ marginTop: 14 }}>
              <Link href="/tech/login" style={{ fontWeight: 700 }}>
                ← Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
