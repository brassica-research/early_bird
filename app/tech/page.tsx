"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  URGENCY_RANK,
  type Submission,
  type Charge,
  type JobPhoto,
} from "@/lib/types";
import { floorLabel } from "@/lib/rooms";

const ETA_OPTIONS = [30, 60, 90, 120, 150, 180, 240];

interface QueueItem {
  id: string;
  createdAt: string;
  category: string;
  categoryLabel: string;
  urgency: "emergency" | "high" | "normal" | "low";
  clientReported: boolean;
  withinNonLicensedScope: boolean;
  estimatedDurationMin: number;
  description: string;
  additionalRequests: string;
  address: string;
  room: string;
  floor: string;
  photoCount: number;
  location: { lat: number; lng: number } | null;
}
interface Assignment {
  job: Submission;
  charges: Charge[];
  photos: JobPhoto[];
}
type Sort = "recent" | "urgent" | "near";

const URGENCY_BADGE: Record<string, string> = {
  emergency: "badge-emergency",
  high: "badge-high",
  normal: "badge-normal",
  low: "badge-low",
};

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function since(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h}h ago`;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Live arrival countdown, mirroring the customer's "Where's my tech?" timer so
// the technician sees the same clock the customer is watching. Ticks locally
// every second off the committed estimated-arrival time.
function EtaCountdown({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = new Date(iso).getTime() - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const clock =
    (h > 0 ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) +
    `:${String(s).padStart(2, "0")}`;
  const arrival = new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <span
      className={`badge ${overdue ? "badge-high" : "badge-ok"}`}
      title={`Arrival ~${arrival}`}
    >
      ⏱ {overdue ? `Overdue ${clock}` : `Arriving in ${clock}`}
    </span>
  );
}

export default function TechApp() {
  const router = useRouter();
  const [tech, setTech] = useState<{ id: string; name: string } | null>(null);
  const [ready, setReady] = useState(false);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [sort, setSort] = useState<Sort>("urgent");

  const [onDuty, setOnDuty] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // --- Identity ---
  useEffect(() => {
    fetch("/api/tech/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setTech(d.tech))
      .catch(() => router.push("/tech/login"))
      .finally(() => setReady(true));
  }, [router]);

  // --- Polling the shared queue + my assignments ---
  const load = useCallback(async () => {
    try {
      const [q, a] = await Promise.all([
        fetch("/api/tech/queue").then((r) => r.json()),
        fetch("/api/tech/assignments").then((r) => r.json()),
      ]);
      if (q.queue) setQueue(q.queue);
      if (a.assignments) setAssignments(a.assignments);
    } catch {
      /* transient; next tick retries */
    }
  }, []);

  useEffect(() => {
    if (!tech) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [tech, load]);

  // --- On-duty geolocation + heartbeat ---
  const heartbeat = useCallback(
    async (duty: boolean, pos: { lat: number; lng: number } | null) => {
      try {
        await fetch("/api/tech/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onDuty: duty, ...(pos ?? {}) }),
        });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  function goOnDuty() {
    setGeoError(null);
    if (!("geolocation" in navigator)) {
      setGeoError("Geolocation isn’t available on this device.");
      setOnDuty(true);
      heartbeat(true, null);
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const c = { lat: p.coords.latitude, lng: p.coords.longitude };
        setCoords(c);
        heartbeat(true, c);
      },
      (err) => setGeoError(err.message || "Location permission denied."),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    watchRef.current = id;
    setOnDuty(true);
    heartbeat(true, coords);
  }

  function goOffDuty() {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setOnDuty(false);
    heartbeat(false, null);
  }

  // Periodic heartbeat while on duty (keeps "live" fresh even without movement).
  useEffect(() => {
    if (!onDuty) return;
    const t = setInterval(() => heartbeat(true, coords), 20000);
    return () => clearInterval(t);
  }, [onDuty, coords, heartbeat]);

  async function claim(id: string) {
    setBusyId(id);
    setNote(null);
    try {
      const res = await fetch("/api/tech/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error || "Could not claim that job.");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function setEta(id: string, etaMinutes: number) {
    setBusyId(id);
    try {
      const res = await fetch("/api/tech/eta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: id, etaMinutes }),
      });
      const data = await res.json();
      if (res.ok) {
        setNote(
          `ETA sent — customer notified${data.notified?.sms ? " (email + SMS)" : " by email"}.`,
        );
      } else {
        setNote(data.error || "Could not set ETA.");
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const sortedQueue = [...queue].sort((a, b) => {
    if (sort === "recent") return b.createdAt.localeCompare(a.createdAt);
    if (sort === "urgent") {
      const d = URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency];
      return d !== 0 ? d : b.createdAt.localeCompare(a.createdAt);
    }
    // near: by distance if we have coords; unknowns last
    if (!coords) return b.createdAt.localeCompare(a.createdAt);
    const da = a.location ? haversineKm(coords, a.location) : Infinity;
    const db = b.location ? haversineKm(coords, b.location) : Infinity;
    return da - db;
  });

  if (!ready) return <main className="section" />;

  return (
    <main className="section">
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="tech-bar">
          <div className="who">{tech?.name}</div>
          <div className="row" style={{ gap: 10 }}>
            {onDuty ? (
              <span className="duty">
                <span className="dot-live" /> On duty
              </span>
            ) : (
              <span className="duty muted">Off duty</span>
            )}
            <button
              className={onDuty ? "btn btn-ghost" : "btn btn-primary"}
              style={{ padding: "8px 14px" }}
              onClick={onDuty ? goOffDuty : goOnDuty}
            >
              {onDuty ? "Go off duty" : "Go on duty"}
            </button>
            <Link
              href="/tech/security"
              className="btn btn-ghost"
              style={{ padding: "8px 14px" }}
            >
              Security
            </Link>
            <button
              className="btn btn-ghost"
              style={{ padding: "8px 14px" }}
              onClick={async () => {
                await fetch("/api/tech/logout", { method: "POST" });
                router.push("/tech/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        {geoError && (
          <div className="alert alert-warn" style={{ marginTop: 12 }}>
            {geoError} You can still work the queue; proximity sorting needs
            location access.
          </div>
        )}
        {note && (
          <div className="alert alert-ok" style={{ marginTop: 12 }}>
            {note}
          </div>
        )}

        {/* My active jobs */}
        {assignments.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 8 }}>Your active jobs</h3>
            {assignments.map(({ job, charges, photos }) => (
              <AssignmentCard
                key={job.id}
                job={job}
                charges={charges}
                photos={photos ?? []}
                busy={busyId === job.id}
                onEta={(m) => setEta(job.id, m)}
                onCharged={load}
              />
            ))}
          </section>
        )}

        {/* Shared queue */}
        <section style={{ marginTop: 22 }}>
          <div className="spread">
            <h3 style={{ margin: 0 }}>Open jobs ({queue.length})</h3>
          </div>
          <div className="sort-tabs" role="tablist" aria-label="Sort queue">
            {(
              [
                ["urgent", "Urgency"],
                ["recent", "Recency"],
                ["near", "Nearest"],
              ] as [Sort, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={sort === key}
                data-on={sort === key}
                onClick={() => setSort(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {sort === "near" && !coords && (
            <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
              Go on duty and allow location to sort by distance.
            </p>
          )}

          {sortedQueue.length === 0 ? (
            <p className="muted">No open jobs right now. New requests appear here live.</p>
          ) : (
            sortedQueue.map((item) => {
              const dist =
                coords && item.location
                  ? haversineKm(coords, item.location) * 0.621371
                  : null;
              return (
                <div key={item.id} className="card job-card">
                  <div className="job-top">
                    <div>
                      <div className="job-cat">{item.categoryLabel}</div>
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className={`badge ${URGENCY_BADGE[item.urgency]}`}>
                        {item.urgency.toUpperCase()}
                        {item.clientReported ? " • client" : ""}
                      </span>
                      {!item.withinNonLicensedScope && (
                        <span className="badge badge-high">licensed</span>
                      )}
                    </div>
                  </div>
                  <div className="job-desc">{item.description}</div>
                  {item.additionalRequests && (
                    <div className="job-extras">
                      <strong>Also while there:</strong> {item.additionalRequests}
                    </div>
                  )}
                  <div className="job-meta">
                    <span className="m">📍 {item.address}</span>
                    <span className="m">
                      🚪 {item.room} · {floorLabel(item.floor)}
                    </span>
                    {item.photoCount > 0 && (
                      <span className="m">📷 {item.photoCount} photo(s)</span>
                    )}
                    {dist != null && (
                      <span className="m dist">{dist.toFixed(1)} mi</span>
                    )}
                    <span className="m">🕒 {since(item.createdAt)}</span>
                    <span className="m">~{item.estimatedDurationMin} min job</span>
                  </div>
                  <div className="form-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busyId === item.id || !onDuty}
                      title={!onDuty ? "Go on duty to claim jobs" : undefined}
                      onClick={() => claim(item.id)}
                    >
                      {busyId === item.id ? (
                        <>
                          <span className="spin" /> Claiming…
                        </>
                      ) : (
                        "Claim job"
                      )}
                    </button>
                    {!onDuty && (
                      <span className="hint">Go on duty to claim.</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function AssignmentCard({
  job,
  charges,
  photos,
  busy,
  onEta,
  onCharged,
}: {
  job: Submission;
  charges: Charge[];
  photos: JobPhoto[];
  busy: boolean;
  onEta: (m: number) => void;
  onCharged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [charging, setCharging] = useState(false);
  const [chargeMsg, setChargeMsg] = useState<string | null>(null);
  const a = job.assignment;

  // --- Close-out report / vendor handoff ---
  const r = job.report ?? null;
  const [resolved, setResolved] = useState<boolean | null>(r?.resolved ?? null);
  const [progress, setProgress] = useState(r?.progress ?? "");
  const [handoffOpen, setHandoffOpen] = useState(!!r?.vendorHandoff);
  const [handoff, setHandoff] = useState(() => ({
    trade: r?.vendorHandoff?.trade ?? "",
    scope: r?.vendorHandoff?.scope ?? "",
    findings: r?.vendorHandoff?.findings ?? "",
    parts: r?.vendorHandoff?.parts ?? "",
    accessNotes: r?.vendorHandoff?.accessNotes ?? "",
    preferredTiming: r?.vendorHandoff?.preferredTiming ?? "",
    notes: r?.vendorHandoff?.notes ?? "",
  }));
  const setH =
    (k: keyof typeof handoff) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setHandoff((h) => ({ ...h, [k]: e.target.value }));
  const [savingReport, setSavingReport] = useState(false);
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

  async function saveReport() {
    setSavingReport(true);
    setReportMsg(null);
    try {
      const res = await fetch("/api/tech/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: job.id,
          resolved,
          progress,
          vendorHandoff: handoffOpen ? handoff : null,
        }),
      });
      const data = await res.json();
      setReportMsg(res.ok ? "Report saved." : data.error || "Could not save report.");
      if (res.ok) onCharged();
    } finally {
      setSavingReport(false);
    }
  }

  async function sendReview() {
    setReviewBusy(true);
    setReviewMsg(null);
    try {
      const res = await fetch("/api/tech/review-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: job.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setReviewMsg(
          `Review request sent${data.notified?.sms ? " (email + SMS)" : " by email"}.`,
        );
        onCharged();
      } else {
        setReviewMsg(data.error || "Could not send review request.");
      }
    } finally {
      setReviewBusy(false);
    }
  }

  async function submitCharge(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(parseFloat(amount) * 100);
    if (!Number.isFinite(cents) || cents <= 0 || !desc.trim()) {
      setChargeMsg("Enter an amount and description.");
      return;
    }
    setCharging(true);
    setChargeMsg(null);
    try {
      const res = await fetch("/api/tech/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId: job.id,
          amountCents: cents,
          description: desc.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAmount("");
        setDesc("");
        setChargeMsg(`Recorded ${money(data.charge.amountCents)}.`);
        onCharged();
      } else {
        setChargeMsg(data.error || "Could not record charge.");
      }
    } finally {
      setCharging(false);
    }
  }

  return (
    <div className="card job-card" style={{ borderColor: "var(--amber)" }}>
      <div className="job-top">
        <div className="job-cat">{job.triage.categoryLabel}</div>
        {a?.estimatedArrival ? (
          <EtaCountdown iso={a.estimatedArrival} />
        ) : (
          <span className="badge badge-high">Set ETA</span>
        )}
      </div>
      <div className="job-meta">
        <span className="m">👤 {job.input.name}</span>
        <span className="m">📞 {job.input.phone}</span>
        <span className="m">📍 {job.input.address}</span>
        <span className="m">
          🚪 {job.input.room} · {floorLabel(job.input.floor)}
        </span>
        {job.visitFee && (
          <span className="m">
            💳 Visit fee {money(job.visitFee.amountCents)} ({job.visitFee.status})
          </span>
        )}
      </div>
      <div className="job-desc">{job.input.description}</div>

      {job.input.additionalRequests && (
        <div className="job-extras">
          <strong>Also while there:</strong> {job.input.additionalRequests}
        </div>
      )}

      {/* Customer photos from intake — tap to open full size. */}
      {photos.length > 0 && (
        <div className="job-photos">
          {photos.map((p) => (
            <a key={p.id} href={p.dataUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.dataUrl} alt={p.name || "Customer photo"} />
            </a>
          ))}
        </div>
      )}

      {a?.etaMinutes == null && (
        <>
          <div className="hint" style={{ fontWeight: 700 }}>
            Commit an arrival ETA (customer is notified):
          </div>
          <div className="eta-grid">
            {ETA_OPTIONS.map((m) => (
              <button key={m} disabled={busy} onClick={() => onEta(m)}>
                {m} min
              </button>
            ))}
          </div>
        </>
      )}

      {/* Billing */}
      <div style={{ marginTop: 8 }}>
        {charges.length > 0 && (
          <div className="job-meta" style={{ marginBottom: 8 }}>
            {charges.map((c) => (
              <span key={c.id} className="m">
                <span className="money">{money(c.amountCents)}</span> ·{" "}
                {c.description} ({c.status})
              </span>
            ))}
          </div>
        )}
        <form className="row" style={{ gap: 8 }} onSubmit={submitCharge}>
          <input
            style={{ maxWidth: 110 }}
            inputMode="decimal"
            placeholder="$0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Charge amount"
          />
          <input
            style={{ flex: 1, minWidth: 120 }}
            placeholder="What for? (e.g. faucet cartridge + labor)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            aria-label="Charge description"
          />
          <button className="btn btn-ghost" disabled={charging}>
            {charging ? "…" : "Add charge"}
          </button>
        </form>
        {chargeMsg && (
          <div className="hint" style={{ marginTop: 6 }}>
            {chargeMsg}
          </div>
        )}
      </div>

      {/* Close-out report + vendor handoff */}
      <div className="report-block">
        <div className="hint" style={{ fontWeight: 700, marginBottom: 6 }}>
          Job report
        </div>

        <div className="form-field" style={{ marginBottom: 8 }}>
          <label>Did you resolve the issue?</label>
          <div className="chips">
            {[
              [true, "Resolved"],
              [false, "Not resolved"],
            ].map(([val, label]) => (
              <span
                key={String(val)}
                className="chip"
                role="button"
                tabIndex={0}
                aria-pressed={resolved === val}
                data-on={resolved === val}
                onClick={() => setResolved(val as boolean)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setResolved(val as boolean);
                  }
                }}
              >
                {label as string}
              </span>
            ))}
          </div>
        </div>

        <div className="form-field">
          <label htmlFor={`prog-${job.id}`}>Issue summary &amp; progress</label>
          <textarea
            id={`prog-${job.id}`}
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            placeholder="What was wrong, what you did on-site, and the current state."
          />
        </div>

        <label className="check-row" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={handoffOpen}
            onChange={(e) => setHandoffOpen(e.target.checked)}
          />
          <span>Hand this lead off to a licensed / 3rd-party vendor</span>
        </label>

        {handoffOpen && (
          <div className="handoff-grid">
            <p className="hint span-2" style={{ margin: "6px 0 2px" }}>
              Customer, address, phone, and the original request are attached
              automatically. Add as much as you can:
            </p>
            <div className="form-field">
              <label>Trade / vendor needed</label>
              <input
                value={handoff.trade}
                onChange={setH("trade")}
                placeholder="e.g. Licensed electrician"
              />
            </div>
            <div className="form-field">
              <label>Preferred timing</label>
              <input
                value={handoff.preferredTiming}
                onChange={setH("preferredTiming")}
                placeholder="Customer availability"
              />
            </div>
            <div className="form-field span-2">
              <label>Scope of work</label>
              <input
                value={handoff.scope}
                onChange={setH("scope")}
                placeholder="What the vendor needs to do"
              />
            </div>
            <div className="form-field span-2">
              <label>On-site findings</label>
              <textarea
                value={handoff.findings}
                onChange={setH("findings")}
                placeholder="What you found (measurements, model #s, condition)"
              />
            </div>
            <div className="form-field">
              <label>Parts / materials</label>
              <input
                value={handoff.parts}
                onChange={setH("parts")}
                placeholder="e.g. 20A GFCI breaker"
              />
            </div>
            <div className="form-field">
              <label>Access notes</label>
              <input
                value={handoff.accessNotes}
                onChange={setH("accessNotes")}
                placeholder="Gate code, pets, parking, best entrance"
              />
            </div>
            <div className="form-field span-2">
              <label>Additional notes</label>
              <textarea
                value={handoff.notes}
                onChange={setH("notes")}
                placeholder="Anything else useful for the vendor"
              />
            </div>
          </div>
        )}

        <div className="form-actions" style={{ marginTop: 10 }}>
          <button
            className="btn btn-primary"
            onClick={saveReport}
            disabled={savingReport}
          >
            {savingReport ? "Saving…" : "Save report"}
          </button>
          <button
            className="btn btn-ghost"
            onClick={sendReview}
            disabled={reviewBusy}
          >
            {reviewBusy ? "Sending…" : "Send review request"}
          </button>
        </div>
        {reportMsg && (
          <div className="hint" style={{ marginTop: 6 }}>
            {reportMsg}
          </div>
        )}
        {reviewMsg && (
          <div className="hint" style={{ marginTop: 4 }}>
            {reviewMsg}
          </div>
        )}
      </div>
    </div>
  );
}
