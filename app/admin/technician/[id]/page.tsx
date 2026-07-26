"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { adminBase } from "@/lib/adminBase";
import type { Submission, DutySession } from "@/lib/types";

interface Tech {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  twoFactorEnabled: boolean;
  createdAt: string;
  onDuty: boolean;
  lastSeenAt: string | null;
}
interface Detail {
  technician: Tech;
  dutySessions: DutySession[];
  jobs: Submission[];
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function duration(a: string, b: string | null): string {
  if (!b) return "open";
  const mins = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function TechnicianHistoryPage() {
  const id = String(useParams().id || "");
  const [base, setBase] = useState("/admin");
  useEffect(() => setBase(adminBase()), []);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/technician?id=${encodeURIComponent(id)}`);
      const d = await res.json();
      if (!res.ok) {
        setError(d.error || "Could not load history.");
        return;
      }
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const totalDutyMins =
    data?.dutySessions.reduce((n, s) => {
      if (!s.clockOutAt) return n;
      return n + (new Date(s.clockOutAt).getTime() - new Date(s.clockInAt).getTime()) / 60000;
    }, 0) ?? 0;

  return (
    <main className="section">
      <div className="container">
        <div className="stack-head">
          <div>
            <p className="eyebrow">Operations · Technician history</p>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              {data?.technician.name ?? (loading ? "Loading…" : "Technician")}
            </h2>
            {data && (
              <p className="muted" style={{ marginTop: 0 }}>
                {data.technician.email}
                {data.technician.phone ? ` · ${data.technician.phone}` : ""} ·{" "}
                {data.technician.twoFactorEnabled ? "2FA on" : "2FA off"} ·{" "}
                since {fmt(data.technician.createdAt)}
              </p>
            )}
          </div>
          <div className="stack-actions">
            <Link href={`${base}/dispatch`} className="btn btn-ghost">
              ← Dispatch
            </Link>
            <button className="btn btn-ghost" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {/* Duty history */}
        <div className="card" style={{ padding: 22, marginTop: 20 }}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>
              Duty history{" "}
              <span className="muted" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                (up to 5 years)
              </span>
            </h3>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {data?.dutySessions.length ?? 0} sessions ·{" "}
              {Math.round(totalDutyMins / 60)}h logged
            </span>
          </div>
          {!data || data.dutySessions.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No duty sessions recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>Clocked in</th>
                    <th>Clocked out</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dutySessions.map((s) => (
                    <tr key={s.id}>
                      <td data-label="Clocked in">{fmt(s.clockInAt)}</td>
                      <td data-label="Clocked out">
                        {s.clockOutAt ? fmt(s.clockOutAt) : "on duty"}
                      </td>
                      <td data-label="Duration">{duration(s.clockInAt, s.clockOutAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Jobs performed */}
        <div className="card" style={{ padding: 22, marginTop: 22 }}>
          <h3 style={{ marginTop: 0 }}>Jobs performed ({data?.jobs.length ?? 0})</h3>
          {!data || data.jobs.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No jobs assigned to this technician yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>Claimed</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>ETA</th>
                    <th>Customer</th>
                    <th>Address</th>
                    <th>Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => (
                    <tr key={j.id}>
                      <td data-label="Claimed" className="muted">
                        {fmt(j.assignment?.claimedAt ?? j.createdAt)}
                      </td>
                      <td data-label="Category">{j.triage.categoryLabel}</td>
                      <td data-label="Status">{j.dispatchStatus}</td>
                      <td data-label="ETA">
                        {j.assignment?.etaMinutes != null ? `${j.assignment.etaMinutes}m` : "—"}
                      </td>
                      <td data-label="Customer">
                        {j.input.name}
                        <br />
                        <span className="muted">{j.input.phone}</span>
                      </td>
                      <td data-label="Address" className="muted">
                        {j.input.address}
                      </td>
                      <td data-label="Issue" className="muted">
                        {j.input.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
