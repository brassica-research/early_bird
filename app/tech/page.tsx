"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { URGENCY_RANK, type Submission, type Charge } from "@/lib/types";

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
  address: string;
  location: { lat: number; lng: number } | null;
}
interface Assignment {
  job: Submission;
  charges: Charge[];
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
            {assignments.map(({ job, charges }) => (
              <AssignmentCard
                key={job.id}
                job={job}
                charges={charges}
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
                  <div className="job-meta">
                    <span className="m">📍 {item.address}</span>
                    {dist != null && (
                      <span className="m dist">{dist.toFixed(1)} mi</span>
                    )}
                    <span className="m">🕒 {since(item.createdAt)}</span>
                    <span className="m">~{item.estimatedDurationMin} min job</span>
                  </div>
                  <div className="form-actions">
                    <button
                      className="btn btn-primary"
                      disabled={busyId === item.id}
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
  busy,
  onEta,
  onCharged,
}: {
  job: Submission;
  charges: Charge[];
  busy: boolean;
  onEta: (m: number) => void;
  onCharged: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [charging, setCharging] = useState(false);
  const [chargeMsg, setChargeMsg] = useState<string | null>(null);
  const a = job.assignment;

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
        {a?.etaMinutes != null ? (
          <span className="badge badge-ok">ETA ~{a.etaMinutes} min</span>
        ) : (
          <span className="badge badge-high">Set ETA</span>
        )}
      </div>
      <div className="job-meta">
        <span className="m">👤 {job.input.name}</span>
        <span className="m">📞 {job.input.phone}</span>
        <span className="m">📍 {job.input.address}</span>
      </div>
      <div className="job-desc">{job.input.description}</div>

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
    </div>
  );
}
