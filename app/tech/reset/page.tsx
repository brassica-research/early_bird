"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don’t match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tech/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not reset your password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="alert alert-danger">
        This reset link is missing its token. Request a new one from{" "}
        <Link href="/tech/forgot">Forgot password</Link>.
      </div>
    );
  }

  if (done) {
    return (
      <>
        <div className="alert alert-ok">
          Your password has been reset. You can sign in now.
        </div>
        <button className="btn btn-primary" onClick={() => router.push("/tech/login")}>
          Go to sign in
        </button>
      </>
    );
  }

  return (
    <>
      {error && <div className="alert alert-danger">{error}</div>}
      <form className="card" style={{ padding: 22 }} onSubmit={submit}>
        <div className="form-field">
          <label htmlFor="pw">New password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            required
          />
          <div className="hint" style={{ marginTop: 5 }}>
            At least 8 characters; screened against known-breached passwords.
          </div>
        </div>
        <div className="form-field" style={{ marginBottom: 16 }}>
          <label htmlFor="pw2">Confirm password</label>
          <input
            id="pw2"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>
            {busy ? (
              <>
                <span className="spin" /> Saving…
              </>
            ) : (
              "Set new password"
            )}
          </button>
        </div>
      </form>
    </>
  );
}

export default function TechResetPage() {
  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 420 }}>
        <p className="eyebrow">Technician</p>
        <h2 className="section-title">Choose a new password</h2>
        <Suspense fallback={null}>
          <ResetForm />
        </Suspense>
      </div>
    </main>
  );
}
