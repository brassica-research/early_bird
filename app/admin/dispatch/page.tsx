"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Submission } from "@/lib/types";

interface TechRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  onDuty: boolean;
  live: boolean;
  location: { lat: number; lng: number } | null;
  lastSeenAt: string | null;
  assignments: Submission[];
}
interface DispatchData {
  queue: Submission[];
  technicians: TechRow[];
  stats: { queued: number; technicians: number; onDuty: number; assigned: number };
}

function since(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

// Self-contained location plot (no external tiles/keys). Markers are projected
// from lat/lng onto the bounding box of all points. Swap in Leaflet/Mapbox for
// a street basemap later — the data shape is already lat/lng.
function LocationMap({
  points,
}: {
  points: { lat: number; lng: number; label: string; kind: "tech" | "job" }[];
}) {
  if (points.length === 0) {
    return (
      <div className="map-empty muted">
        No live locations yet — technician markers appear here once someone is on
        duty with location sharing on.
      </div>
    );
  }
  const W = 100;
  const H = 62;
  const pad = 8;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  let minLat = Math.min(...lats),
    maxLat = Math.max(...lats),
    minLng = Math.min(...lngs),
    maxLng = Math.max(...lngs);
  // Guarantee a non-zero span so a single point sits centered.
  if (maxLat - minLat < 0.01) { minLat -= 0.02; maxLat += 0.02; }
  if (maxLng - minLng < 0.01) { minLng -= 0.02; maxLng += 0.02; }
  const px = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng)) * (W - 2 * pad);
  const py = (lat: number) => pad + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * pad);

  return (
    <svg className="map-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Technician locations">
      <rect x="0" y="0" width={W} height={H} className="map-bg" />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`h${f}`} x1={0} y1={H * f} x2={W} y2={H * f} className="map-grid" />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`v${f}`} x1={W * f} y1={0} x2={W * f} y2={H} className="map-grid" />
      ))}
      {points.map((p, i) => (
        <g key={i} transform={`translate(${px(p.lng)}, ${py(p.lat)})`}>
          {p.kind === "tech" ? (
            <circle r="2.4" className="map-tech" />
          ) : (
            <rect x="-1.8" y="-1.8" width="3.6" height="3.6" className="map-job" />
          )}
          <title>{p.label}</title>
        </g>
      ))}
    </svg>
  );
}

export default function AdminDispatchPage() {
  const [data, setData] = useState<DispatchData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await fetch("/api/admin/dispatch").then((r) => r.json());
      if (d.stats) setData(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const points: {
    lat: number;
    lng: number;
    label: string;
    kind: "tech" | "job";
  }[] =
    data?.technicians
      .filter((t) => t.location)
      .map((t) => ({
        lat: t.location!.lat,
        lng: t.location!.lng,
        label: `${t.name}${t.live ? " (on duty)" : ""}`,
        kind: "tech" as const,
      })) ?? [];
  data?.queue.forEach((j) => {
    if (j.location)
      points.push({ lat: j.location.lat, lng: j.location.lng, label: j.triage.categoryLabel, kind: "job" });
  });

  return (
    <main className="section">
      <div className="container">
        <div className="stack-head">
          <div>
            <p className="eyebrow">Operations</p>
            <h2 className="section-title" style={{ marginBottom: 4 }}>
              Dispatch board
            </h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Live queue, technicians, and locations.
            </p>
          </div>
          <div className="stack-actions">
            <Link href="/admin" className="btn btn-ghost">
              ← Dashboard
            </Link>
            <button className="btn btn-ghost" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="stat-grid" style={{ marginTop: 20 }}>
          <Stat label="Jobs in queue" value={String(data?.stats.queued ?? "…")} />
          <Stat label="Technicians on duty" value={String(data?.stats.onDuty ?? "…")} />
          <Stat label="Active assignments" value={String(data?.stats.assigned ?? "…")} />
        </div>

        {/* Map */}
        <div className="card" style={{ padding: 18, marginTop: 22 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Technician locations</h3>
            <div className="row" style={{ gap: 14, fontSize: "0.8rem" }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="legend-dot legend-tech" /> Technician
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="legend-dot legend-job" /> Queued job
              </span>
            </div>
          </div>
          <LocationMap points={points} />
        </div>

        {/* Technicians */}
        <div className="card" style={{ padding: 22, marginTop: 22 }}>
          <h3 style={{ marginTop: 0 }}>Technicians</h3>
          {!data || data.technicians.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No technician accounts yet.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Last seen</th>
                    <th>Location</th>
                    <th>Active jobs</th>
                    <th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {data.technicians.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Name">
                        <strong>{t.name}</strong>
                      </td>
                      <td data-label="Status">
                        {t.live ? (
                          <span className="duty">
                            <span className="dot-live" /> On duty
                          </span>
                        ) : t.onDuty ? (
                          "Idle"
                        ) : (
                          "Off duty"
                        )}
                      </td>
                      <td data-label="Last seen">{since(t.lastSeenAt)}</td>
                      <td data-label="Location">
                        {t.location
                          ? `${t.location.lat.toFixed(3)}, ${t.location.lng.toFixed(3)}`
                          : "—"}
                      </td>
                      <td data-label="Active jobs">
                        {t.assignments.length === 0
                          ? "—"
                          : t.assignments
                              .map(
                                (j) =>
                                  `${j.triage.categoryLabel}${
                                    j.assignment?.etaMinutes != null
                                      ? ` (ETA ${j.assignment.etaMinutes}m)`
                                      : ""
                                  }`,
                              )
                              .join("; ")}
                      </td>
                      <td data-label="Contact" className="muted">
                        {t.email}
                        {t.phone ? ` · ${t.phone}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Queue */}
        <div className="card" style={{ padding: 22, marginTop: 22 }}>
          <h3 style={{ marginTop: 0 }}>Queue ({data?.queue.length ?? 0})</h3>
          {!data || data.queue.length === 0 ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              No jobs waiting.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="responsive">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Category</th>
                    <th>Urgency</th>
                    <th>Customer</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {data.queue.map((j) => (
                    <tr key={j.id}>
                      <td data-label="When" className="muted">
                        {since(j.createdAt)}
                      </td>
                      <td data-label="Category">{j.triage.categoryLabel}</td>
                      <td data-label="Urgency">
                        {j.input.clientUrgency ?? j.triage.urgency}
                        {j.input.clientUrgency ? " (client)" : ""}
                      </td>
                      <td data-label="Customer">
                        {j.input.name}
                        <br />
                        <span className="muted">{j.input.phone}</span>
                      </td>
                      <td data-label="Address" className="muted">
                        {j.input.address}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="muted" style={{ fontSize: "0.8rem", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: "1.8rem", fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}
