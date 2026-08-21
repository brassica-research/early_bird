"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminBase } from "@/lib/adminBase";
import type { Submission, FeedbackRecord } from "@/lib/types";
import type { HeuristicConfig } from "@/lib/store/types";
import { floorLabel } from "@/lib/rooms";
import { formatMoney } from "@/lib/pricing";

interface FeedbackStats {
  total: number;
  withLlm: number;
  categoryAgreement: number | null;
  urgencyAgreement: number | null;
  scopeAgreement: number | null;
  openProposals: number;
}

interface PendingProposal {
  proposal: {
    op: string;
    category?: string;
    term: string;
    weight?: number;
    urgency?: string;
    rationale: string;
  };
  count: number;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="muted" style={{ fontSize: "0.8rem", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [base, setBase] = useState("/admin");
  useEffect(() => setBase(adminBase()), []);
  const [config, setConfig] = useState<HeuristicConfig | null>(null);
  const [pending, setPending] = useState<PendingProposal[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, f, s] = await Promise.all([
        fetch("/api/heuristic").then((r) => r.json()),
        fetch("/api/feedback").then((r) => r.json()),
        fetch("/api/submissions").then((r) => r.json()),
      ]);
      setConfig(h.config);
      setPending(h.pending || []);
      setStats(f.stats);
      setRecords(f.records || []);
      setSubmissions(s.submissions || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function applyAll() {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/heuristic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all_pending" }),
      });
      const data = await res.json();
      setMessage(
        `Applied ${data.applied?.length ?? 0} change(s). Config is now v${
          data.config?.version
        }.`,
      );
      await load();
    } finally {
      setApplying(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push(`${base}/login`);
    router.refresh();
  }

  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <main className="section">
      <div className="container">
        <div className="stack-head">
          <div>
            <p className="eyebrow">Operations</p>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Triage & feedback dashboard
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Heuristic config{" "}
              <strong>v{config?.version ?? "…"}</strong> · the heuristic learns
              from LLM triage below.
            </p>
          </div>
          <div className="stack-actions">
            <Link href={`${base}/dispatch`} className="btn btn-primary">
              Dispatch board →
            </Link>
            <button className="btn btn-ghost" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>

        {message && (
          <div className="alert alert-ok" style={{ marginTop: 16 }}>
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="stat-grid" style={{ marginTop: 20 }}>
          <Stat label="Submissions" value={String(submissions.length)} />
          <Stat
            label="Triaged (LLM active)"
            value={stats ? String(stats.withLlm) : "…"}
          />
          <Stat
            label="Open heuristic proposals"
            value={stats ? String(stats.openProposals) : "…"}
          />
        </div>
        <div className="stat-grid" style={{ marginTop: 16 }}>
          <Stat
            label="Category agreement (LLM vs heuristic)"
            value={pct(stats?.categoryAgreement ?? null)}
          />
          <Stat
            label="Urgency agreement"
            value={pct(stats?.urgencyAgreement ?? null)}
          />
          <Stat
            label="Scope agreement"
            value={pct(stats?.scopeAgreement ?? null)}
          />
        </div>

        {/* Feedback loop */}
        <div className="card" style={{ padding: 22, marginTop: 28 }}>
          <div className="stack-head">
            <div>
              <h3 style={{ margin: 0 }}>Heuristic improvements (pending)</h3>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Concrete changes Claude proposed after disagreeing with the
                heuristic. Apply them to bump the rules — no code edit.
              </p>
            </div>
            <div className="stack-actions">
              <button
                className="btn btn-primary"
                onClick={applyAll}
                disabled={applying || pending.length === 0}
              >
                {applying ? "Applying…" : `Apply all (${pending.length})`}
              </button>
            </div>
          </div>

          {pending.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No pending proposals. The heuristic is in sync with recent LLM
              triage.
            </p>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>Op</th>
                    <th>Target</th>
                    <th>Term</th>
                    <th>Detail</th>
                    <th>Rationale</th>
                    <th>×</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p, i) => (
                    <tr key={i}>
                      <td data-label="Op">
                        <code>{p.proposal.op}</code>
                      </td>
                      <td data-label="Target">
                        {p.proposal.category || p.proposal.urgency || "—"}
                      </td>
                      <td data-label="Term">
                        <strong>{p.proposal.term}</strong>
                      </td>
                      <td data-label="Detail">
                        {p.proposal.weight != null
                          ? `weight ${p.proposal.weight}`
                          : p.proposal.urgency
                            ? p.proposal.urgency
                            : "—"}
                      </td>
                      <td data-label="Rationale" className="muted">
                        {p.proposal.rationale}
                      </td>
                      <td data-label="Times proposed">{p.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent triage comparisons */}
        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Recent triage comparisons</h3>
          {records.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No triage records yet. Submit an intake to populate this.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Heuristic</th>
                    <th>LLM</th>
                    <th>Agree?</th>
                    <th>Proposals</th>
                  </tr>
                </thead>
                <tbody>
                  {records.slice(0, 25).map((r) => (
                    <tr key={r.id}>
                      <td data-label="When" className="muted">
                        {fmt(r.createdAt)}
                      </td>
                      <td data-label="Heuristic">
                        {r.heuristic.category} / {r.heuristic.urgency}
                      </td>
                      <td data-label="LLM">
                        {r.llm
                          ? `${r.llm.category} / ${r.llm.urgency}`
                          : "— (heuristic only)"}
                      </td>
                      <td data-label="Agree?">
                        {r.llmAvailable
                          ? r.categoriesAgree && r.urgenciesAgree
                            ? "✓"
                            : "✗"
                          : "n/a"}
                      </td>
                      <td data-label="Proposals">{r.proposals.length || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Submissions */}
        <div className="card" style={{ padding: 22, marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Recent submissions</h3>
          {submissions.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No submissions yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Name</th>
                    <th>Category</th>
                    <th>Where</th>
                    <th>Urgency</th>
                    <th>Scope</th>
                    <th>Booking</th>
                    <th>Visit fee</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.slice(0, 25).map((s) => (
                    <tr key={s.id}>
                      <td data-label="When" className="muted">
                        {fmt(s.createdAt)}
                      </td>
                      <td data-label="Name">{s.input.name}</td>
                      <td data-label="Category">{s.triage.categoryLabel}</td>
                      <td data-label="Where">
                        {s.input.room} · {floorLabel(s.input.floor)}
                        {s.photoCount ? ` · ${s.photoCount} 📷` : ""}
                      </td>
                      <td data-label="Urgency">{s.triage.urgency}</td>
                      <td data-label="Scope">
                        {s.triage.withinNonLicensedScope
                          ? "In scope"
                          : "Licensed pro"}
                      </td>
                      <td data-label="Booking">{s.bookingStatus}</td>
                      <td data-label="Visit fee">
                        {s.visitFee
                          ? `${formatMoney(s.visitFee.amountCents)} (${s.visitFee.status})`
                          : "—"}
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
