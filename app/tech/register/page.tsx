"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TechRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    inviteCode: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tech/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create your account.");
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
        <h2 className="section-title">Create your account</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          You’ll need the invite code from your dispatcher.
        </p>

        {error && <div className="alert alert-danger">{error}</div>}

        <form className="card" style={{ padding: 22 }} onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="invite">Invite code</label>
            <input id="invite" value={form.inviteCode} onChange={set("inviteCode")} required />
          </div>
          <div className="form-field">
            <label htmlFor="name">Full name</label>
            <input id="name" value={form.name} onChange={set("name")} required />
          </div>
          <div className="form-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={set("email")}
              autoComplete="username"
              required
            />
          </div>
          <div className="form-field" style={{ marginBottom: 8 }}>
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              type="password"
              value={form.password}
              onChange={set("password")}
              autoComplete="new-password"
              required
            />
            <div className="hint" style={{ marginTop: 5 }}>
              At least 8 characters. Longer passphrases are stronger; we screen
              against known-breached passwords.
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="spin" /> Creating…
                </>
              ) : (
                "Create account"
              )}
            </button>
          </div>
        </form>

        <div className="row" style={{ marginTop: 14 }}>
          <Link href="/tech/login" style={{ fontWeight: 700 }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
