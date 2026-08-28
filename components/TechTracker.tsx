"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@/lib/types";
import type { TrackStage, TrackView } from "@/lib/tracking";
import { setActiveVisit, clearActiveVisit } from "@/lib/activeVisit";

// ---------------------------------------------------------------------------
// "Where's my tech?" — the customer's live arrival view.
//
// Polls /api/track/:id and renders three things: a stage timeline, a coarse
// proximity map (the technician's approximate position relative to the home,
// deliberately fuzzy — see lib/tracking), and a countdown to the committed
// ETA that ticks locally between polls so it feels live without hammering the
// server.
//
// The countdown is anchored to the SERVER clock: each poll records the offset
// between server time and this browser's clock, so a device with a skewed
// clock still counts down correctly.
// ---------------------------------------------------------------------------

const POLL_MS = 15_000;

const STAGES: { key: TrackStage; label: string }[] = [
  { key: "requested", label: "Booked" },
  { key: "accepted", label: "Tech assigned" },
  { key: "en_route", label: "On the way" },
  { key: "arriving", label: "Arriving" },
];

function stageIndex(stage: TrackStage): number {
  const i = STAGES.findIndex((s) => s.key === stage);
  if (i >= 0) return i;
  return stage === "completed" ? STAGES.length : -1;
}

/** Coarse proximity plot: home at the center, technician offset toward them. */
function ProximityMap({
  home,
  tech,
  milesAway,
}: {
  home: GeoPoint | null;
  tech: GeoPoint | null;
  milesAway: number | null;
}) {
  const W = 100;
  const H = 62;
  const cx = W / 2;
  const cy = H / 2;

  // Scale so the technician always sits inside the frame regardless of
  // distance — this is a relative-position diagram, not a street map.
  let tx = cx;
  let ty = cy;
  if (home && tech) {
    const dLng = tech.lng - home.lng;
    const dLat = tech.lat - home.lat;
    const mag = Math.max(Math.abs(dLng), Math.abs(dLat)) || 1;
    const reach = 0.34; // fraction of the frame the tech dot can travel out to
    tx = cx + (dLng / mag) * W * reach;
    ty = cy - (dLat / mag) * H * reach;
  }

  return (
    <svg
      className="map-svg track-map"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        milesAway != null
          ? `Technician approximately ${milesAway} miles away`
          : "Technician location not available yet"
      }
    >
      <rect x="0" y="0" width={W} height={H} className="map-bg" />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`h${f}`} x1={0} y1={H * f} x2={W} y2={H * f} className="map-grid" />
      ))}
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={`v${f}`} x1={W * f} y1={0} x2={W * f} y2={H} className="map-grid" />
      ))}

      {/* Home */}
      <g transform={`translate(${cx}, ${cy})`}>
        <circle r="8" className="track-home-halo" />
        <circle r="2.6" className="track-home" />
        <title>Your home</title>
      </g>

      {tech && (
        <>
          <line x1={tx} y1={ty} x2={cx} y2={cy} className="track-path" />
          <g transform={`translate(${tx}, ${ty})`}>
            {/* The halo is the honest part: the dot is only accurate to ~1 mile. */}
            <circle r="7" className="track-tech-halo" />
            <circle r="2.8" className="track-tech" />
            <title>Approximate technician location</title>
          </g>
        </>
      )}
    </svg>
  );
}

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TechTracker({
  submissionId,
  compact = false,
}: {
  submissionId: string;
  /** Compact mode drops the heading — used inline on the confirmation step. */
  compact?: boolean;
}) {
  const [track, setTrack] = useState<TrackView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** serverNow - Date.now() at the last poll, in ms. */
  const skewRef = useRef(0);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${submissionId}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Couldn't load your visit.");
        return;
      }
      skewRef.current = new Date(data.track.serverNow).getTime() - Date.now();
      setTrack(data.track);
      setError(null);
      // Remember this visit so the customer can always navigate back here from
      // the site header — and forget it once the visit is over.
      if (data.track.stage === "completed" || data.track.stage === "cancelled") {
        clearActiveVisit();
      } else {
        setActiveVisit(submissionId);
      }
    } catch {
      /* transient — the next poll retries */
    } finally {
      setLoaded(true);
    }
  }, [submissionId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Local 1s tick so the countdown moves between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!loaded) {
    return (
      <div className="track-card card">
        <span className="spin" /> Checking on your technician…
      </div>
    );
  }
  if (error) {
    return <div className="alert alert-warn">{error}</div>;
  }
  if (!track) return null;

  const now = Date.now() + skewRef.current;
  const arrivalMs = track.estimatedArrival
    ? new Date(track.estimatedArrival).getTime()
    : null;
  const secondsLeft =
    arrivalMs != null ? Math.max(0, Math.round((arrivalMs - now) / 1000)) : null;
  const mins = secondsLeft != null ? Math.floor(secondsLeft / 60) : null;
  const secs = secondsLeft != null ? secondsLeft % 60 : null;

  // Countdown bar: how much of the committed window has elapsed.
  let progress = 0;
  if (track.etaCommittedAt && arrivalMs != null) {
    const startMs = new Date(track.etaCommittedAt).getTime();
    const span = arrivalMs - startMs;
    progress = span > 0 ? Math.min(1, Math.max(0, (now - startMs) / span)) : 1;
  }

  const active = stageIndex(track.stage);
  const isDone = track.stage === "completed" || track.stage === "cancelled";
  // `tick` drives the re-render for the countdown; reference it so the
  // dependency is explicit rather than incidental.
  void tick;

  return (
    <div className="track-card card">
      {!compact && (
        <div className="track-head">
          <span className="track-eyebrow">Where&rsquo;s my tech?</span>
          <span className="track-ref">Ref {track.submissionId.slice(0, 8)}</span>
        </div>
      )}

      <h3 className="track-headline">{track.headline}</h3>

      {/* Stage timeline */}
      <ol className="track-steps" aria-label="Visit progress">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            data-on={!isDone && i <= active}
            data-current={!isDone && i === active}
          >
            <span className="track-dot" aria-hidden="true" />
            <span className="track-step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {/* Countdown */}
      {secondsLeft != null && !isDone && (
        <div className="track-countdown">
          <div className="track-clock">
            {secondsLeft === 0 ? (
              <span className="track-now">Arriving any minute</span>
            ) : (
              <>
                <span className="track-big">
                  {mins}:{String(secs).padStart(2, "0")}
                </span>
                <span className="track-unit">until arrival</span>
              </>
            )}
          </div>
          <div className="track-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <p className="track-sub">
            Estimated arrival around{" "}
            <strong>{formatClock(track.estimatedArrival)}</strong>
            {track.etaMinutes != null && (
              <> · {track.etaMinutes}-minute ETA committed by your technician</>
            )}
          </p>
        </div>
      )}

      {/* Proximity map */}
      {!isDone && (
        <div className="track-map-wrap">
          <ProximityMap
            home={track.destination}
            tech={track.tech?.approxLocation ?? null}
            milesAway={track.tech?.approxMilesAway ?? null}
          />
          <div className="track-legend">
            <span>
              <span className="legend-dot track-legend-home" /> Your home
            </span>
            <span>
              <span className="legend-dot track-legend-tech" /> {track.tech?.firstName ?? "Technician"}
            </span>
          </div>
          <p className="track-distance">
            {track.tech?.approxLocation && track.tech.approxMilesAway != null ? (
              <>
                About <strong>{track.tech.approxMilesAway} mi</strong> away, coming
                from the {track.tech.directionFrom}.
              </>
            ) : track.stage === "requested" ? (
              <>Location appears once a technician accepts your job.</>
            ) : track.tech?.locationStale ? (
              <>
                Location paused — we last heard from {track.tech.firstName}{" "}
                {formatClock(track.tech.lastSeenAt)}.
              </>
            ) : (
              <>
                {track.tech?.firstName ?? "Your technician"} hasn&rsquo;t shared
                location for this trip.
              </>
            )}
          </p>
          <p className="track-privacy">
            Location is approximate — rounded to about{" "}
            {track.tech?.approxAccuracyMiles ?? 0.7} mi and shown only while your
            technician is on the way.
          </p>
        </div>
      )}
    </div>
  );
}
